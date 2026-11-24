/* Embedded GTK4/Libadwaita "Software Update" page inside GNOME Settings.
 *
 * Loaded via LD_PRELOAD only by /usr/bin/gnome-control-center wrapper.
 * Resolves public GTK4 / Libadwaita / GLib symbols dynamically via dlsym()
 * so it needs zero -dev headers and survives minor package upgrades.
 *
 * When the user clicks the "Software Update" row (widget name
 * "kos-open-software-update-btn") injected into Settings -> System or
 * Settings -> System -> About, this pushes a native AdwNavigationPage
 * ("Software Update") right inside the Settings window's AdwNavigationView.
 */

#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

typedef unsigned long GType;
typedef unsigned int guint;
typedef unsigned long gulong;
typedef int gboolean;
typedef void *gpointer;

#define FALSE 0
#define TRUE 1
#define GTK_ORIENTATION_HORIZONTAL 0
#define GTK_ORIENTATION_VERTICAL 1
#define GTK_ALIGN_START 1
#define GTK_ALIGN_END 2
#define GTK_ALIGN_CENTER 3
#define G_SPAWN_SEARCH_PATH 4
#define G_IO_IN 1
#define G_IO_ERR 8
#define G_IO_HUP 16
#define G_IO_NVAL 32
#define G_IO_STATUS_NORMAL 1
#define G_IO_STATUS_AGAIN 3

static struct {
    guint (*g_idle_add)(gboolean (*)(gpointer), gpointer);
    guint (*g_signal_lookup)(const char *, GType);
    gulong (*g_signal_add_emission_hook)(guint, guint, gboolean (*)(gpointer, guint, const gpointer, gpointer), gpointer, gpointer);
    gulong (*g_signal_connect_data)(gpointer, const char *, void (*)(void), gpointer, gpointer, int);
    gpointer (*g_value_get_object)(const gpointer);
    void (*g_free)(gpointer);
    char **(*g_get_environ)(void);
    char **(*g_environ_unsetenv)(char **, const char *);
    void (*g_strfreev)(char **);
    gboolean (*g_spawn_async_with_pipes)(const char *, char **, char **, int, gpointer, gpointer, int *, int *, int *, int *, gpointer *);
    gpointer (*g_io_channel_unix_new)(int);
    guint (*g_io_add_watch)(gpointer, int, gboolean (*)(gpointer, int, gpointer), gpointer);
    int (*g_io_channel_read_line)(gpointer, char **, gulong *, gulong *, gpointer *);
    int (*g_io_channel_shutdown)(gpointer, gboolean, gpointer *);
    void (*g_io_channel_unref)(gpointer);

    GType (*gtk_widget_get_type)(void);
    GType (*gtk_button_get_type)(void);
    const char *(*gtk_widget_get_name)(gpointer);
    gpointer (*gtk_widget_get_ancestor)(gpointer, GType);
    gpointer (*gtk_widget_get_root)(gpointer);
    void (*gtk_widget_set_visible)(gpointer, gboolean);
    void (*gtk_widget_set_sensitive)(gpointer, gboolean);
    void (*gtk_widget_set_valign)(gpointer, int);
    void (*gtk_widget_set_halign)(gpointer, int);
    void (*gtk_widget_set_hexpand)(gpointer, gboolean);
    void (*gtk_widget_set_margin_top)(gpointer, int);
    void (*gtk_widget_set_margin_bottom)(gpointer, int);
    void (*gtk_widget_set_margin_start)(gpointer, int);
    void (*gtk_widget_set_margin_end)(gpointer, int);
    void (*gtk_widget_add_css_class)(gpointer, const char *);
    void (*gtk_widget_set_tooltip_text)(gpointer, const char *);

    gpointer (*gtk_box_new)(int, int);
    void (*gtk_box_append)(gpointer, gpointer);
    gpointer (*gtk_image_new_from_icon_name)(const char *);
    void (*gtk_image_set_pixel_size)(gpointer, int);
    gpointer (*gtk_label_new)(const char *);
    void (*gtk_label_set_text)(gpointer, const char *);
    void (*gtk_label_set_xalign)(gpointer, float);
    void (*gtk_label_set_wrap)(gpointer, gboolean);
    gpointer (*gtk_spinner_new)(void);
    void (*gtk_spinner_start)(gpointer);
    void (*gtk_spinner_stop)(gpointer);
    gpointer (*gtk_progress_bar_new)(void);
    void (*gtk_progress_bar_set_show_text)(gpointer, gboolean);
    void (*gtk_progress_bar_set_fraction)(gpointer, double);
    void (*gtk_progress_bar_set_text)(gpointer, const char *);
    gpointer (*gtk_button_new_with_label)(const char *);
    gpointer (*gtk_button_new_from_icon_name)(const char *);
    void (*gtk_button_set_label)(gpointer, const char *);

    GType (*adw_navigation_view_get_type)(void);
    gpointer (*adw_navigation_page_new)(gpointer, const char *);
    void (*adw_navigation_view_push)(gpointer, gpointer);
    gpointer (*adw_toolbar_view_new)(void);
    void (*adw_toolbar_view_add_top_bar)(gpointer, gpointer);
    void (*adw_toolbar_view_set_content)(gpointer, gpointer);
    gpointer (*adw_header_bar_new)(void);
    void (*adw_header_bar_pack_start)(gpointer, gpointer);
    void (*adw_header_bar_pack_end)(gpointer, gpointer);
    gpointer (*adw_preferences_page_new)(void);
    void (*adw_preferences_page_add)(gpointer, gpointer);
    gpointer (*adw_preferences_group_new)(void);
    void (*adw_preferences_group_set_title)(gpointer, const char *);
    void (*adw_preferences_group_add)(gpointer, gpointer);
    void (*adw_preferences_group_remove)(gpointer, gpointer);
    gpointer (*adw_action_row_new)(void);
    void (*adw_preferences_row_set_title)(gpointer, const char *);
    void (*adw_action_row_set_subtitle)(gpointer, const char *);
    gpointer (*adw_dialog_new)(void);
    void (*adw_dialog_set_title)(gpointer, const char *);
    void (*adw_dialog_set_content_width)(gpointer, int);
    void (*adw_dialog_set_content_height)(gpointer, int);
    void (*adw_dialog_set_child)(gpointer, gpointer);
    void (*adw_dialog_present)(gpointer, gpointer);
} api;

#define LOAD_SYM(name) do { \
    *(void **)(&api.name) = dlsym(RTLD_DEFAULT, #name); \
    if (!api.name) return FALSE; \
} while (0)

static gboolean load_symbols(void) {
    LOAD_SYM(g_idle_add);
    LOAD_SYM(g_signal_lookup);
    LOAD_SYM(g_signal_add_emission_hook);
    LOAD_SYM(g_signal_connect_data);
    LOAD_SYM(g_value_get_object);
    LOAD_SYM(g_free);
    LOAD_SYM(g_get_environ);
    LOAD_SYM(g_environ_unsetenv);
    LOAD_SYM(g_strfreev);
    LOAD_SYM(g_spawn_async_with_pipes);
    LOAD_SYM(g_io_channel_unix_new);
    LOAD_SYM(g_io_add_watch);
    LOAD_SYM(g_io_channel_read_line);
    LOAD_SYM(g_io_channel_shutdown);
    LOAD_SYM(g_io_channel_unref);

    LOAD_SYM(gtk_widget_get_type);
    LOAD_SYM(gtk_button_get_type);
    LOAD_SYM(gtk_widget_get_name);
    LOAD_SYM(gtk_widget_get_ancestor);
    LOAD_SYM(gtk_widget_get_root);
    LOAD_SYM(gtk_widget_set_visible);
    LOAD_SYM(gtk_widget_set_sensitive);
    LOAD_SYM(gtk_widget_set_valign);
    LOAD_SYM(gtk_widget_set_halign);
    LOAD_SYM(gtk_widget_set_hexpand);
    LOAD_SYM(gtk_widget_set_margin_top);
    LOAD_SYM(gtk_widget_set_margin_bottom);
    LOAD_SYM(gtk_widget_set_margin_start);
    LOAD_SYM(gtk_widget_set_margin_end);
    LOAD_SYM(gtk_widget_add_css_class);
    LOAD_SYM(gtk_widget_set_tooltip_text);

    LOAD_SYM(gtk_box_new);
    LOAD_SYM(gtk_box_append);
    LOAD_SYM(gtk_image_new_from_icon_name);
    LOAD_SYM(gtk_image_set_pixel_size);
    LOAD_SYM(gtk_label_new);
    LOAD_SYM(gtk_label_set_text);
    LOAD_SYM(gtk_label_set_xalign);
    LOAD_SYM(gtk_label_set_wrap);
    LOAD_SYM(gtk_spinner_new);
    LOAD_SYM(gtk_spinner_start);
    LOAD_SYM(gtk_spinner_stop);
    LOAD_SYM(gtk_progress_bar_new);
    LOAD_SYM(gtk_progress_bar_set_show_text);
    LOAD_SYM(gtk_progress_bar_set_fraction);
    LOAD_SYM(gtk_progress_bar_set_text);
    LOAD_SYM(gtk_button_new_with_label);
    LOAD_SYM(gtk_button_new_from_icon_name);
    LOAD_SYM(gtk_button_set_label);

    LOAD_SYM(adw_navigation_view_get_type);
    LOAD_SYM(adw_navigation_page_new);
    LOAD_SYM(adw_navigation_view_push);
    LOAD_SYM(adw_toolbar_view_new);
    LOAD_SYM(adw_toolbar_view_add_top_bar);
    LOAD_SYM(adw_toolbar_view_set_content);
    LOAD_SYM(adw_header_bar_new);
    LOAD_SYM(adw_header_bar_pack_start);
    LOAD_SYM(adw_header_bar_pack_end);
    LOAD_SYM(adw_preferences_page_new);
    LOAD_SYM(adw_preferences_page_add);
    LOAD_SYM(adw_preferences_group_new);
    LOAD_SYM(adw_preferences_group_set_title);
    LOAD_SYM(adw_preferences_group_add);
    LOAD_SYM(adw_preferences_group_remove);
    LOAD_SYM(adw_action_row_new);
    LOAD_SYM(adw_preferences_row_set_title);
    LOAD_SYM(adw_action_row_set_subtitle);
    LOAD_SYM(adw_dialog_new);
    LOAD_SYM(adw_dialog_set_title);
    LOAD_SYM(adw_dialog_set_content_width);
    LOAD_SYM(adw_dialog_set_content_height);
    LOAD_SYM(adw_dialog_set_child);
    LOAD_SYM(adw_dialog_present);
    return TRUE;
}

#define MAX_NOTES 32

typedef struct {
    gboolean busy;
    gboolean destroyed;
    char state[32];
    gpointer title_lbl;
    gpointer vendor_lbl;
    gpointer state_lbl;
    gpointer spinner;
    gpointer last_group;
    gpointer last_row;
    gpointer update_group;
    gpointer update_row;
    gpointer notes_group;
    gpointer note_rows[MAX_NOTES];
    int n_notes;
    gpointer progress_bar;
    gpointer refresh_btn;
    gpointer open_btn;
    gpointer cancel_btn;
    gpointer primary_btn;
} UpdateView;

static void clear_notes(UpdateView *v) {
    for (int i = 0; i < v->n_notes; i++) {
        api.adw_preferences_group_remove(v->notes_group, v->note_rows[i]);
        v->note_rows[i] = NULL;
    }
    v->n_notes = 0;
    api.gtk_widget_set_visible(v->notes_group, FALSE);
}

static void split_tsv(char *line, char **cols, int max_cols, int *out_n) {
    size_t len = strlen(line);
    while (len > 0 && (line[len - 1] == '\n' || line[len - 1] == '\r'))
        line[--len] = '\0';
    int n = 0;
    char *p = line;
    while (n < max_cols) {
        cols[n++] = p;
        char *tab = strchr(p, '\t');
        if (!tab)
            break;
        *tab = '\0';
        p = tab + 1;
    }
    *out_n = n;
}

static void on_content_destroyed(gpointer _widget, gpointer data) {
    (void)_widget;
    UpdateView *v = (UpdateView *)data;
    v->destroyed = TRUE;
    if (!v->busy)
        free(v);
}

static gboolean on_backend_io(gpointer ch, int cond, gpointer user_data) {
    UpdateView *v = (UpdateView *)user_data;
    if (cond & G_IO_IN) {
        char *line = NULL;
        gulong len = 0, term = 0;
        while (api.g_io_channel_read_line(ch, &line, &len, &term, NULL) == G_IO_STATUS_NORMAL && line) {
            if (v->destroyed) {
                api.g_free(line);
                line = NULL;
                continue;
            }
            char *cols[8] = {0};
            int n = 0;
            split_tsv(line, cols, 8, &n);
            if (n >= 1) {
                if (strcmp(cols[0], "STATUS") == 0 && n >= 5) {
                    snprintf(v->state, sizeof(v->state), "%s", cols[1]);
                    api.gtk_label_set_text(v->title_lbl, cols[2]);
                    api.gtk_label_set_text(v->vendor_lbl, cols[3]);
                    api.gtk_label_set_text(v->state_lbl, cols[4]);
                    clear_notes(v);
                    api.gtk_widget_set_visible(v->update_group, FALSE);
                    api.gtk_widget_set_visible(v->last_group, FALSE);
                    api.gtk_widget_set_visible(v->progress_bar, FALSE);

                    if (strcmp(v->state, "available") == 0) {
                        api.gtk_button_set_label(v->primary_btn, "Download & Install");
                        api.gtk_widget_set_visible(v->primary_btn, TRUE);
                        api.gtk_widget_set_visible(v->cancel_btn, FALSE);
                    } else if (strcmp(v->state, "local_ready") == 0) {
                        api.gtk_button_set_label(v->primary_btn, "Install & Restart");
                        api.gtk_widget_set_visible(v->primary_btn, TRUE);
                        api.gtk_widget_set_visible(v->cancel_btn, FALSE);
                    } else if (strcmp(v->state, "staged") == 0) {
                        api.gtk_button_set_label(v->primary_btn, "Restart Now");
                        api.gtk_widget_set_visible(v->primary_btn, TRUE);
                        api.gtk_widget_set_visible(v->cancel_btn, TRUE);
                    } else {
                        api.gtk_widget_set_visible(v->primary_btn, FALSE);
                        api.gtk_widget_set_visible(v->cancel_btn, FALSE);
                    }
                } else if (strcmp(cols[0], "LAST") == 0 && n >= 3) {
                    api.adw_preferences_row_set_title(v->last_row, cols[1]);
                    api.adw_action_row_set_subtitle(v->last_row, cols[2]);
                    api.gtk_widget_set_visible(v->last_group, TRUE);
                } else if (strcmp(cols[0], "UPDATE") == 0 && n >= 3) {
                    api.adw_preferences_row_set_title(v->update_row, cols[1]);
                    api.adw_action_row_set_subtitle(v->update_row, cols[2]);
                    api.gtk_widget_set_visible(v->update_group, TRUE);
                } else if (strcmp(cols[0], "NOTE") == 0 && n >= 2 && v->n_notes < MAX_NOTES) {
                    gpointer r = api.adw_action_row_new();
                    api.adw_preferences_row_set_title(r, cols[1]);
                    api.adw_preferences_group_add(v->notes_group, r);
                    v->note_rows[v->n_notes++] = r;
                    api.gtk_widget_set_visible(v->notes_group, TRUE);
                } else if (strcmp(cols[0], "PROGRESS") == 0 && n >= 3) {
                    double frac = atof(cols[1]);
                    api.gtk_progress_bar_set_fraction(v->progress_bar, frac);
                    api.gtk_progress_bar_set_text(v->progress_bar, cols[2]);
                    api.gtk_widget_set_visible(v->progress_bar, TRUE);
                } else if (strcmp(cols[0], "ERROR") == 0 && n >= 2) {
                    api.gtk_label_set_text(v->state_lbl, cols[1]);
                    api.gtk_widget_set_visible(v->progress_bar, FALSE);
                }
            }
            api.g_free(line);
            line = NULL;
        }
    }
    if (cond & (G_IO_HUP | G_IO_ERR | G_IO_NVAL)) {
        v->busy = FALSE;
        if (!v->destroyed) {
            api.gtk_spinner_stop(v->spinner);
            api.gtk_widget_set_sensitive(v->refresh_btn, TRUE);
            api.gtk_widget_set_sensitive(v->open_btn, TRUE);
            api.gtk_widget_set_sensitive(v->primary_btn, TRUE);
            api.gtk_widget_set_sensitive(v->cancel_btn, TRUE);
        } else {
            free(v);
        }
        api.g_io_channel_shutdown(ch, FALSE, NULL);
        api.g_io_channel_unref(ch);
        return FALSE;
    }
    return TRUE;
}

static void run_backend(UpdateView *v, const char *subcmd, const char *busy_msg) {
    if (v->busy)
        return;
    v->busy = TRUE;
    if (busy_msg)
        api.gtk_label_set_text(v->state_lbl, busy_msg);
    api.gtk_spinner_start(v->spinner);
    api.gtk_widget_set_sensitive(v->refresh_btn, FALSE);
    api.gtk_widget_set_sensitive(v->open_btn, FALSE);
    api.gtk_widget_set_sensitive(v->primary_btn, FALSE);
    api.gtk_widget_set_sensitive(v->cancel_btn, FALSE);

    char *argv[] = {
        "/usr/bin/python3",
        "/usr/libexec/kos-update-backend",
        "--tsv",
        (char *)subcmd,
        NULL
    };
    char **envp = api.g_get_environ();
    envp = api.g_environ_unsetenv(envp, "LD_PRELOAD");
    int out_fd = -1;
    gboolean ok = api.g_spawn_async_with_pipes(
        NULL, argv, envp, G_SPAWN_SEARCH_PATH,
        NULL, NULL, NULL, NULL, &out_fd, NULL, NULL);
    api.g_strfreev(envp);

    if (!ok || out_fd < 0) {
        v->busy = FALSE;
        api.gtk_spinner_stop(v->spinner);
        api.gtk_widget_set_sensitive(v->refresh_btn, TRUE);
        api.gtk_widget_set_sensitive(v->open_btn, TRUE);
        api.gtk_label_set_text(v->state_lbl, "Could not start update service.");
        return;
    }
    gpointer ch = api.g_io_channel_unix_new(out_fd);
    api.g_io_add_watch(ch, G_IO_IN | G_IO_HUP | G_IO_ERR | G_IO_NVAL, on_backend_io, v);
}

static void on_refresh_clicked(gpointer _btn, gpointer data) {
    (void)_btn;
    run_backend((UpdateView *)data, "check", "Checking for updates…");
}

static void on_open_clicked(gpointer _btn, gpointer data) {
    (void)_btn;
    run_backend((UpdateView *)data, "pick", "Select an update file (.pxu)…");
}

static void on_cancel_clicked(gpointer _btn, gpointer data) {
    (void)_btn;
    run_backend((UpdateView *)data, "cancel", "Cancelling staged update…");
}

static void on_primary_clicked(gpointer _btn, gpointer data) {
    (void)_btn;
    UpdateView *v = (UpdateView *)data;
    if (strcmp(v->state, "staged") == 0) {
        char *argv[] = {"systemctl", "reboot", NULL};
        char **envp = api.g_get_environ();
        envp = api.g_environ_unsetenv(envp, "LD_PRELOAD");
        api.g_spawn_async_with_pipes(NULL, argv, envp, G_SPAWN_SEARCH_PATH, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
        api.g_strfreev(envp);
        return;
    }
    run_backend(v, "install", "Preparing update…");
}

static gpointer build_software_update_content(UpdateView **out_view) {
    UpdateView *v = (UpdateView *)calloc(1, sizeof(UpdateView));

    gpointer toolbar = api.adw_toolbar_view_new();
    gpointer header = api.adw_header_bar_new();

    v->open_btn = api.gtk_button_new_from_icon_name("document-open-symbolic");
    api.gtk_widget_set_tooltip_text(v->open_btn, "Install Update File (.pxu)…");
    api.g_signal_connect_data(v->open_btn, "clicked", (void (*)(void))on_open_clicked, v, NULL, 0);
    api.adw_header_bar_pack_start(header, v->open_btn);

    v->refresh_btn = api.gtk_button_new_from_icon_name("view-refresh-symbolic");
    api.gtk_widget_set_tooltip_text(v->refresh_btn, "Check for Updates");
    api.g_signal_connect_data(v->refresh_btn, "clicked", (void (*)(void))on_refresh_clicked, v, NULL, 0);
    api.adw_header_bar_pack_end(header, v->refresh_btn);

    api.adw_toolbar_view_add_top_bar(toolbar, header);

    gpointer pref_page = api.adw_preferences_page_new();

    /* Hero identity group */
    gpointer hero_group = api.adw_preferences_group_new();
    gpointer hero_box = api.gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 16);
    api.gtk_widget_set_margin_top(hero_box, 8);
    api.gtk_widget_set_margin_bottom(hero_box, 12);

    gpointer logo = api.gtk_image_new_from_icon_name("proxim-logo");
    api.gtk_image_set_pixel_size(logo, 60);
    api.gtk_box_append(hero_box, logo);

    gpointer text_col = api.gtk_box_new(GTK_ORIENTATION_VERTICAL, 4);
    api.gtk_widget_set_valign(text_col, GTK_ALIGN_CENTER);
    api.gtk_widget_set_hexpand(text_col, TRUE);

    v->title_lbl = api.gtk_label_new("Proxim OS");
    api.gtk_label_set_xalign(v->title_lbl, 0.0f);
    api.gtk_widget_add_css_class(v->title_lbl, "title-1");
    api.gtk_box_append(text_col, v->title_lbl);

    v->vendor_lbl = api.gtk_label_new("Atahastra  •  Channel: stable");
    api.gtk_label_set_xalign(v->vendor_lbl, 0.0f);
    api.gtk_widget_add_css_class(v->vendor_lbl, "dim-label");
    api.gtk_box_append(text_col, v->vendor_lbl);

    v->state_lbl = api.gtk_label_new("Checking for updates…");
    api.gtk_label_set_xalign(v->state_lbl, 0.0f);
    api.gtk_label_set_wrap(v->state_lbl, TRUE);
    api.gtk_box_append(text_col, v->state_lbl);

    api.gtk_box_append(hero_box, text_col);

    v->spinner = api.gtk_spinner_new();
    api.gtk_widget_set_valign(v->spinner, GTK_ALIGN_CENTER);
    api.gtk_box_append(hero_box, v->spinner);

    api.adw_preferences_group_add(hero_group, hero_box);
    api.adw_preferences_page_add(pref_page, hero_group);

    /* Last update result group */
    v->last_group = api.adw_preferences_group_new();
    v->last_row = api.adw_action_row_new();
    api.adw_preferences_group_add(v->last_group, v->last_row);
    api.gtk_widget_set_visible(v->last_group, FALSE);
    api.adw_preferences_page_add(pref_page, v->last_group);

    /* Available update group */
    v->update_group = api.adw_preferences_group_new();
    api.adw_preferences_group_set_title(v->update_group, "Available Update");
    v->update_row = api.adw_action_row_new();
    api.adw_preferences_group_add(v->update_group, v->update_row);
    api.gtk_widget_set_visible(v->update_group, FALSE);
    api.adw_preferences_page_add(pref_page, v->update_group);

    /* Release notes group */
    v->notes_group = api.adw_preferences_group_new();
    api.adw_preferences_group_set_title(v->notes_group, "What's New");
    api.gtk_widget_set_visible(v->notes_group, FALSE);
    api.adw_preferences_page_add(pref_page, v->notes_group);

    /* Progress + primary action group */
    gpointer act_group = api.adw_preferences_group_new();
    gpointer act_col = api.gtk_box_new(GTK_ORIENTATION_VERTICAL, 12);

    v->progress_bar = api.gtk_progress_bar_new();
    api.gtk_progress_bar_set_show_text(v->progress_bar, TRUE);
    api.gtk_widget_set_visible(v->progress_bar, FALSE);
    api.gtk_box_append(act_col, v->progress_bar);

    gpointer btn_row = api.gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 10);
    api.gtk_widget_set_halign(btn_row, GTK_ALIGN_END);

    v->cancel_btn = api.gtk_button_new_with_label("Cancel Staged Update");
    api.gtk_widget_set_visible(v->cancel_btn, FALSE);
    api.g_signal_connect_data(v->cancel_btn, "clicked", (void (*)(void))on_cancel_clicked, v, NULL, 0);
    api.gtk_box_append(btn_row, v->cancel_btn);

    v->primary_btn = api.gtk_button_new_with_label("Download & Install");
    api.gtk_widget_add_css_class(v->primary_btn, "suggested-action");
    api.gtk_widget_set_visible(v->primary_btn, FALSE);
    api.g_signal_connect_data(v->primary_btn, "clicked", (void (*)(void))on_primary_clicked, v, NULL, 0);
    api.gtk_box_append(btn_row, v->primary_btn);

    api.gtk_box_append(act_col, btn_row);
    api.adw_preferences_group_add(act_group, act_col);
    api.adw_preferences_page_add(pref_page, act_group);

    api.adw_toolbar_view_set_content(toolbar, pref_page);
    api.g_signal_connect_data(toolbar, "destroy", (void (*)(void))on_content_destroyed, v, NULL, 0);
    *out_view = v;
    return toolbar;
}

static gboolean on_any_button_clicked(gpointer ihint, guint n_params, const gpointer params, gpointer data) {
    (void)ihint;
    (void)n_params;
    (void)data;
    gpointer btn = api.g_value_get_object(params);
    if (!btn)
        return TRUE;
    const char *name = api.gtk_widget_get_name(btn);
    if (!name || strcmp(name, "kos-open-software-update-btn") != 0)
        return TRUE;

    UpdateView *view = NULL;
    gpointer content = build_software_update_content(&view);

    gpointer nav = api.gtk_widget_get_ancestor(btn, api.adw_navigation_view_get_type());
    if (nav) {
        gpointer page = api.adw_navigation_page_new(content, "Software Update");
        api.adw_navigation_view_push(nav, page);
    } else {
        gpointer dlg = api.adw_dialog_new();
        api.adw_dialog_set_title(dlg, "Software Update");
        api.adw_dialog_set_content_width(dlg, 540);
        api.adw_dialog_set_content_height(dlg, 460);
        api.adw_dialog_set_child(dlg, content);
        api.adw_dialog_present(dlg, api.gtk_widget_get_root(btn));
    }

    run_backend(view, "check", "Checking for updates…");
    return TRUE;
}

static gboolean on_any_widget_mapped(gpointer ihint, guint n_params, const gpointer params, gpointer data) {
    (void)ihint;
    (void)n_params;
    (void)data;
    gpointer w = api.g_value_get_object(params);
    if (!w)
        return TRUE;
    const char *name = api.gtk_widget_get_name(w);
    if (name && strcmp(name, "kos-hide-me") == 0)
        api.gtk_widget_set_visible(w, FALSE);
    return TRUE;
}

static gboolean install_hook_idle(gpointer data) {
    (void)data;
    if (!load_symbols())
        return FALSE;
    guint click_sig = api.g_signal_lookup("clicked", api.gtk_button_get_type());
    if (click_sig != 0)
        api.g_signal_add_emission_hook(click_sig, 0, on_any_button_clicked, NULL, NULL);
    guint map_sig = api.g_signal_lookup("map", api.gtk_widget_get_type());
    if (map_sig != 0)
        api.g_signal_add_emission_hook(map_sig, 0, on_any_widget_mapped, NULL, NULL);
    return FALSE;
}

__attribute__((constructor))
static void kos_settings_update_init(void) {
    guint (*idle_add)(gboolean (*)(gpointer), gpointer) = dlsym(RTLD_DEFAULT, "g_idle_add");
    if (idle_add)
        idle_add(install_hook_idle, NULL);
}
