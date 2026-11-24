/* Hide only the built-in "Home" row in GNOME Files (Nautilus) sidebar,
 * keeping Recent, Starred, Network, Trash, and all folder bookmarks visible.
 *
 * Loaded via LD_PRELOAD only by /usr/bin/nautilus wrapper.
 * Resolves GTK4/GIO/GObject/GLib symbols via dlsym() so it needs no -dev headers.
 */

#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdio.h>
#include <string.h>

typedef unsigned long GType;
typedef unsigned int guint;
typedef unsigned long gulong;
typedef int gboolean;
typedef void *gpointer;

#define FALSE 0
#define TRUE 1

static struct {
    guint (*g_timeout_add)(guint, gboolean (*)(gpointer), gpointer);
    gulong (*g_signal_connect_data)(gpointer, const char *, void (*)(void), gpointer, gpointer, int);
    gboolean (*g_type_check_instance_is_a)(gpointer, GType);
    void (*g_object_unref)(gpointer);
    gpointer (*g_object_get_data)(gpointer, const char *);
    void (*g_object_set_data)(gpointer, const char *, gpointer);
    guint (*g_list_model_get_n_items)(gpointer);
    gpointer (*g_list_model_get_item)(gpointer, guint);

    GType (*gtk_list_box_row_get_type)(void);
    GType (*gtk_label_get_type)(void);
    gpointer (*gtk_window_get_toplevels)(void);
    const char *(*gtk_label_get_text)(gpointer);
    gpointer (*gtk_widget_get_first_child)(gpointer);
    gpointer (*gtk_widget_get_next_sibling)(gpointer);
    gboolean (*gtk_widget_get_visible)(gpointer);
    void (*gtk_widget_set_visible)(gpointer, gboolean);
} api;

#define LOAD_SYM(name) do { \
    *(void **)(&api.name) = dlsym(RTLD_DEFAULT, #name); \
    if (!api.name) { fprintf(stderr, "kos-nautilus: missing symbol %s\n", #name); return FALSE; } \
} while (0)

static gboolean load_symbols(void) {
    LOAD_SYM(g_timeout_add);
    LOAD_SYM(g_signal_connect_data);
    LOAD_SYM(g_type_check_instance_is_a);
    LOAD_SYM(g_object_unref);
    LOAD_SYM(g_object_get_data);
    LOAD_SYM(g_object_set_data);
    LOAD_SYM(g_list_model_get_n_items);
    LOAD_SYM(g_list_model_get_item);

    LOAD_SYM(gtk_list_box_row_get_type);
    LOAD_SYM(gtk_label_get_type);
    LOAD_SYM(gtk_window_get_toplevels);
    LOAD_SYM(gtk_label_get_text);
    LOAD_SYM(gtk_widget_get_first_child);
    LOAD_SYM(gtk_widget_get_next_sibling);
    LOAD_SYM(gtk_widget_get_visible);
    LOAD_SYM(gtk_widget_set_visible);
    return TRUE;
}

static gboolean has_home_label(gpointer w, int depth) {
    if (depth > 8)
        return FALSE;
    for (gpointer c = api.gtk_widget_get_first_child(w); c; c = api.gtk_widget_get_next_sibling(c)) {
        if (api.g_type_check_instance_is_a(c, api.gtk_label_get_type())) {
            const char *txt = api.gtk_label_get_text(c);
            if (txt && (strcmp(txt, "Home") == 0 || strcmp(txt, "_Home") == 0))
                return TRUE;
        }
        if (has_home_label(c, depth + 1))
            return TRUE;
    }
    return FALSE;
}

static void on_home_row_notify_visible(gpointer row, gpointer pspec, gpointer data) {
    (void)pspec;
    (void)data;
    if (api.gtk_widget_get_visible(row))
        api.gtk_widget_set_visible(row, FALSE);
}

static void hide_if_home_row(gpointer row) {
    if (!api.g_type_check_instance_is_a(row, api.gtk_list_box_row_get_type()))
        return;
    if (!has_home_label(row, 0))
        return;
    if (api.gtk_widget_get_visible(row))
        api.gtk_widget_set_visible(row, FALSE);
    if (!api.g_object_get_data(row, "kos-home-hidden")) {
        api.g_object_set_data(row, "kos-home-hidden", (gpointer)1);
        api.g_signal_connect_data(
            row, "notify::visible",
            (void (*)(void))on_home_row_notify_visible,
            NULL, NULL, 0);
    }
}

static void walk_widget(gpointer w, int depth) {
    if (!w || depth > 24)
        return;
    hide_if_home_row(w);
    for (gpointer c = api.gtk_widget_get_first_child(w); c; c = api.gtk_widget_get_next_sibling(c))
        walk_widget(c, depth + 1);
}

static gboolean scan_toplevels(gpointer data) {
    (void)data;
    gpointer list = api.gtk_window_get_toplevels();
    if (!list)
        return FALSE;
    guint n = api.g_list_model_get_n_items(list);
    for (guint i = 0; i < n; i++) {
        gpointer win = api.g_list_model_get_item(list, i);
        if (win) {
            walk_widget(win, 0);
            api.g_object_unref(win);
        }
    }
    return FALSE;
}

static void on_toplevels_changed(gpointer list, guint pos, guint removed, guint added, gpointer data) {
    (void)list;
    (void)pos;
    (void)removed;
    (void)data;
    if (added > 0) {
        api.g_timeout_add(50, scan_toplevels, NULL);
        api.g_timeout_add(200, scan_toplevels, NULL);
        api.g_timeout_add(600, scan_toplevels, NULL);
    }
}

static gboolean install_hook_idle(gpointer data) {
    (void)data;
    if (!load_symbols())
        return FALSE;
    gpointer list = api.gtk_window_get_toplevels();
    if (list) {
        api.g_signal_connect_data(
            list, "items-changed",
            (void (*)(void))on_toplevels_changed,
            NULL, NULL, 0);
    }
    api.g_timeout_add(100, scan_toplevels, NULL);
    api.g_timeout_add(400, scan_toplevels, NULL);
    api.g_timeout_add(1200, scan_toplevels, NULL);
    return FALSE;
}

__attribute__((constructor))
static void kos_nautilus_init(void) {
    guint (*timeout_add)(guint, gboolean (*)(gpointer), gpointer) = dlsym(RTLD_DEFAULT, "g_timeout_add");
    if (timeout_add)
        timeout_add(50, install_hook_idle, NULL);
}
