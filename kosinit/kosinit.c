/*
 * kosinit — PID 1 for KOS (tiny, Android-style). The kernel execs /init
 * and that process must never exit. It mounts essential filesystems,
 * starts /etc/kos/services, reaps children (and orphans), and shuts
 * down on signal. BusyBox `poweroff` sends SIGUSR2, `reboot` sends
 * SIGTERM: both are a clean poweroff here. SIGINT (ctrl-alt-del) reboots.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mount.h>
#include <sys/prctl.h>
#include <sys/reboot.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#define MAX_SERVICES 16
#define MAX_ARGS 16
#define BACKOFF_SEC 1
#define SERVICES_PATH "/etc/kos/services"

enum { ONCE, RESPAWN };

struct service {
	char name[32];
	int mode;                 /* ONCE or RESPAWN */
	char *argv[MAX_ARGS];
	char argbuf[256];         /* backing store for argv strings */
	pid_t pid;                /* 0 = not running */
	time_t restart_after;     /* respawn backoff deadline */
};

static struct service services[MAX_SERVICES];
static int nservices, cons_fd = -1;
static volatile sig_atomic_t want_poweroff, want_reboot;

static void on_poweroff(int sig) { (void)sig; want_poweroff = 1; }
static void on_reboot(int sig)   { (void)sig; want_reboot = 1; }

static void logmsg(const char *fmt, ...)
{
	char buf[256];
	va_list ap;
	int n;

	va_start(ap, fmt);
	n = vsnprintf(buf, sizeof(buf) - 1, fmt, ap);
	va_end(ap);
	if (n < 0) return;
	if (n > (int)sizeof(buf) - 2) n = (int)sizeof(buf) - 2;
	buf[n++] = '\n';
	(void)write(cons_fd >= 0 ? cons_fd : STDERR_FILENO, buf, (size_t)n);
}

/* mkdir + mount; ignore EEXIST / EBUSY so a second pass is harmless. */
static void mount_one(const char *src, const char *tgt, const char *type,
		     const char *data)
{
	if (mkdir(tgt, 0755) < 0 && errno != EEXIST)
		logmsg("kosinit: mkdir %s: %s", tgt, strerror(errno));
	if (mount(src, tgt, type, 0, data) < 0 && errno != EBUSY)
		logmsg("kosinit: mount %s: %s", tgt, strerror(errno));
}

static void mount_essentials(void)
{
	mkdir("/tmp", 01777); /* EEXIST ok */
	mount_one("proc",     "/proc", "proc",     NULL);
	mount_one("sysfs",    "/sys",  "sysfs",    NULL);
	mount_one("devtmpfs", "/dev",  "devtmpfs", NULL);
	mount_one("tmpfs",    "/tmp",  "tmpfs",    "mode=1777");
	mount_one("tmpfs",    "/run",  "tmpfs",    "mode=0755");
}
/* Line format:  name  respawn|once  /path  [args...] */
static int parse_services(const char *path)
{
	FILE *fp = fopen(path, "r");
	char line[256];
	int lineno = 0;

	if (!fp) {
		logmsg("kosinit: cannot open %s: %s", path, strerror(errno));
		return -1;
	}
	while (fgets(line, sizeof(line), fp)) {
		struct service *s;
		char *p = line, *nl, *tok, *mode;
		int argc = 0;

		lineno++;
		while (*p == ' ' || *p == '\t')
			p++;
		if (*p == '\0' || *p == '\n' || *p == '#') continue;
		if ((nl = strchr(p, '\n'))) *nl = '\0';
		if (nservices >= MAX_SERVICES) {
			logmsg("kosinit: too many services, ignoring line %d", lineno);
			break;
		}
		s = &services[nservices];
		memset(s, 0, sizeof(*s));
		snprintf(s->argbuf, sizeof(s->argbuf), "%s", p);
		tok = strtok(s->argbuf, " \t");
		mode = strtok(NULL, " \t");
		if (!tok || !mode) {
			logmsg("kosinit: bad service line %d", lineno);
			continue;
		}
		snprintf(s->name, sizeof(s->name), "%s", tok);
		if (!strcmp(mode, "respawn"))
			s->mode = RESPAWN;
		else if (!strcmp(mode, "once"))
			s->mode = ONCE;
		else {
			logmsg("kosinit: unknown mode '%s' on line %d", mode, lineno);
			continue;
		}
		while ((tok = strtok(NULL, " \t")) && argc < MAX_ARGS - 1)
			s->argv[argc++] = tok;
		s->argv[argc] = NULL;
		if (argc < 1) {
			logmsg("kosinit: no command for '%s'", s->name);
			continue;
		}
		nservices++;
	}
	fclose(fp);
	return 0;
}
/* Shell gets a controlling tty (like cttyhack) so stdin works on serial. */
static int wants_ctty(const struct service *s)
{
	const char *base = strrchr(s->argv[0], '/');

	base = base ? base + 1 : s->argv[0];
	return !strcmp(s->name, "shell") || !strcmp(base, "sh") || !strcmp(base, "ash");
}

static void setup_child_stdio(int ctty)
{
	int fd;

	setsid();
	if (ctty) {
		fd = open("/dev/ttyS0", O_RDWR);
		if (fd < 0) fd = open("/dev/console", O_RDWR);
		if (fd >= 0) {
			ioctl(fd, TIOCSCTTY, 0);
			dup2(fd, 0); dup2(fd, 1); dup2(fd, 2);
			if (fd > 2) close(fd);
		}
		return;
	}
	if ((fd = open("/dev/null", O_RDONLY)) >= 0) {
		dup2(fd, 0);
		if (fd > 2) close(fd);
	}
	if ((fd = open("/dev/console", O_WRONLY)) >= 0) {
		dup2(fd, 1); dup2(fd, 2);
		if (fd > 2) close(fd);
	}
}

static void start_service(struct service *s)
{
	pid_t pid;

	logmsg("kosinit: starting %s (%s)", s->name,
	       s->mode == RESPAWN ? "respawn" : "once");
	pid = fork();
	if (pid < 0) {
		logmsg("kosinit: fork %s: %s", s->name, strerror(errno));
		s->restart_after = time(NULL) + BACKOFF_SEC;
		return;
	}
	if (pid == 0) {
		setup_child_stdio(wants_ctty(s));
		putenv("PATH=/bin:/sbin:/usr/bin:/usr/sbin");
		putenv("HOME=/root");
		putenv("TERM=linux");
		execv(s->argv[0], s->argv);
		logmsg("kosinit: exec %s: %s", s->argv[0], strerror(errno));
		_exit(127);
	}
	s->pid = pid;
}

static void handle_exit(pid_t pid, int st)
{
	int i, status;

	status = WIFEXITED(st) ? WEXITSTATUS(st) :
		 (WIFSIGNALED(st) ? 128 + WTERMSIG(st) : st);
	for (i = 0; i < nservices; i++) {
		struct service *s = &services[i];
		if (s->pid != pid) continue;
		s->pid = 0;
		s->restart_after = time(NULL); /* marks ONCE as consumed */
		if (s->mode == RESPAWN && !want_poweroff && !want_reboot) {
			logmsg("kosinit: %s exited (status %d), restarting", s->name, status);
			s->restart_after = time(NULL) + BACKOFF_SEC;
		} else {
			logmsg("kosinit: %s exited (status %d)", s->name, status);
		}
		return;
	}
	/* Orphan we inherited — already reaped by waitpid. */
}
static void start_due_services(void)
{
	int i;
	time_t now = time(NULL);

	for (i = 0; i < nservices; i++) {
		struct service *s = &services[i];
		if (s->pid != 0) continue;
		if (s->mode == ONCE && s->restart_after) continue; /* already ran */
		if (!s->restart_after || now >= s->restart_after)
			start_service(s);
	}
}

static void shutdown_now(int rb_cmd, const char *why)
{
	logmsg("kosinit: %s", why);
	signal(SIGTERM, SIG_IGN);
	signal(SIGUSR2, SIG_IGN);
	signal(SIGINT, SIG_IGN);
	kill(-1, SIGTERM);
	sleep(1);
	kill(-1, SIGKILL);
	while (waitpid(-1, NULL, WNOHANG) > 0)
		;
	sync();
	reboot(rb_cmd);
	for (;;) pause();
}

static void install_signals(void)
{
	struct sigaction sa = {0};

	sigemptyset(&sa.sa_mask);
	/* no SA_RESTART: sleep/waitpid must return EINTR on shutdown */
	sa.sa_handler = on_poweroff;
	sigaction(SIGUSR2, &sa, NULL);
	sigaction(SIGTERM, &sa, NULL);
	sa.sa_handler = on_reboot;
	sigaction(SIGINT, &sa, NULL);
	signal(SIGTTOU, SIG_IGN);
	signal(SIGTTIN, SIG_IGN);
	signal(SIGTSTP, SIG_IGN);
	signal(SIGPIPE, SIG_IGN);
}

int main(void)
{
	prctl(PR_SET_NAME, "kosinit");
	umask(0022);
	install_signals();
	mount_essentials();

	cons_fd = open("/dev/console", O_RDWR | O_NOCTTY);
	if (cons_fd < 0) cons_fd = open("/dev/ttyS0", O_RDWR | O_NOCTTY);
	if (cons_fd >= 0) {
		dup2(cons_fd, 0); dup2(cons_fd, 1); dup2(cons_fd, 2);
	}

	logmsg("kosinit: starting kos");
	if (getpid() != 1)
		logmsg("kosinit: warning: not PID 1 (pid=%d)", (int)getpid());
	putenv("PATH=/bin:/sbin:/usr/bin:/usr/sbin");
	parse_services(SERVICES_PATH);
	start_due_services();

	for (;;) {
		int st;
		pid_t pid;

		if (want_poweroff) shutdown_now(RB_POWER_OFF, "poweroff");
		if (want_reboot) shutdown_now(RB_AUTOBOOT, "reboot");
		start_due_services();
		pid = waitpid(-1, &st, WNOHANG);
		if (pid == 0) { sleep(1); continue; }
		if (pid < 0) {
			if (errno != EINTR && errno != ECHILD)
				logmsg("kosinit: waitpid: %s", strerror(errno));
			continue;
		}
		handle_exit(pid, st);
	}
}
