//! kosd — first KOS userspace service (no external crates).
//!
//! Prints a hello + memory/uptime status, then a heartbeat every 10 seconds
//! on stdout (kosinit routes that to the console).

use std::fs;
use std::io::{self, Write};
use std::process;
use std::thread;
use std::time::Duration;

const HEARTBEAT_SECS: u64 = 10;

fn uptime_secs() -> Option<f64> {
    // /proc/uptime: "<seconds> <idle_seconds>"
    let s = fs::read_to_string("/proc/uptime").ok()?;
    s.split_whitespace().next()?.parse().ok()
}

fn mem_kb(key: &str) -> Option<u64> {
    // /proc/meminfo lines look like: "MemTotal:        12345 kB"
    let s = fs::read_to_string("/proc/meminfo").ok()?;
    for line in s.lines() {
        if let Some(rest) = line.strip_prefix(key) {
            return rest.split_whitespace().next()?.parse().ok();
        }
    }
    None
}

fn say(line: &str) {
    let _ = writeln!(io::stdout(), "{line}");
    let _ = io::stdout().flush();
}

fn main() {
    let pid = process::id();
    say(&format!("kosd: hello from rust (pid {pid})"));

    let uptime = uptime_secs().unwrap_or(0.0);
    let total = mem_kb("MemTotal:").unwrap_or(0);
    let free = mem_kb("MemFree:").unwrap_or(0);
    say(&format!(
        "kosd: status uptime={uptime:.0}s mem_total={total}kB mem_free={free}kB"
    ));

    loop {
        thread::sleep(Duration::from_secs(HEARTBEAT_SECS));
        let u = uptime_secs().unwrap_or(0.0);
        say(&format!("kosd: heartbeat uptime={u:.0}s"));
    }
}
