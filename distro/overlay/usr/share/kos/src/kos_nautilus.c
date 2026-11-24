/* Hide the built-in "Home" row in GNOME Files (Nautilus) sidebar.
 *
 * Loaded via LD_PRELOAD only by /usr/bin/nautilus wrapper.
 * Resolves GTK4/GLib symbols via dlsym() so it needs no -dev headers.
 */

#define _GNU_SOURCE
#include <dlfcn.h>
#include <string.h>

typedef unsigned long GType;
typedef unsigned int guint;
typedef unsigned long gulong;
typedef int gboolean;
typedef void *gpointer;

#define FALSE 0
#define TRUE 1

static struct {
    guint (*g_idle_add)(gboolean (*)(gpointer), gpointer);
    guint (*g_signal_lookup)(const char *, GType);
    gulong (*g_signal_add_emission_hook)(guint, guint, gboolean (*)(gpointer, guint, const gpointer, gpointer), gpointer, gpointer);
    gpointer (*g_value_get_object)(const gpointer);
    gboolean (*g_type_check_instance_is_a)(gpointer, GType);

    GType (*gtk_list_box_row_get_type)(void);
    GType (*gtk_label_get_type)(void);
    const char *(*gtk_label_get_text)(gpointer);
    gpointer (*gtk_widget_get_first_child)(gpointer);
    gpointer (*gtk_widget_get_next_sibling)(gpointer);
    gpointer (*gtk_widget_get_parent)(gpointer);
    const char *(*gtk_widget_get_css_name)(gpointer);
    gboolean (*gtk_widget_has_css_class)(gpointer, const char *);
    void (*gtk_widget_set_visible)(gpointer, gboolean);
} api;

#define LOAD_SYM(name) do { \
    *(void **)(&api.name) = dlsym(RTLD_DEFAULT, #name); \
    if (!api.name) return FALSE; \
} while (0)

static gboolean load_symbols(void) {
    LOAD_SYM(g_idle_add);
    LOAD_SYM(g_signal_lookup);
    LOAD_SYM(g_signal_add_emission_hook);
    LOAD_SYM(g_value_get_object);
    LOAD_SYM(g_type_check_instance_is_a);

    LOAD_SYM(gtk_list_box_row_get_type);
    LOAD_SYM(gtk_label_get_type);
    LOAD_SYM(gtk_label_get_text);
    LOAD_SYM(gtk_widget_get_first_child);
    LOAD_SYM(gtk_widget_get_next_sibling);
    LOAD_SYM(gtk_widget_get_parent);
    LOAD_SYM(gtk_widget_get_css_name);
    LOAD_SYM(gtk_widget_has_css_class);
    LOAD_SYM(gtk_widget_set_visible);
    return TRUE;
}

static gboolean in_places_sidebar(gpointer w) {
    gpointer cur = api.gtk_widget_get_parent(w);
    for (int depth = 0; cur && depth < 12; depth++) {
        const char *css = api.gtk_widget_get_css_name(cur);
        if (css && strcmp(css, "placessidebar") == 0)
            return TRUE;
        if (api.gtk_widget_has_css_class(cur, "sidebar-row") ||
            api.gtk_widget_has_css_class(cur, "navigation-sidebar"))
            return TRUE;
        cur = api.gtk_widget_get_parent(cur);
    }
    return FALSE;
}

static gboolean has_home_label(gpointer w) {
    for (gpointer c = api.gtk_widget_get_first_child(w); c; c = api.gtk_widget_get_next_sibling(c)) {
        if (api.g_type_check_instance_is_a(c, api.gtk_label_get_type())) {
            const char *txt = api.gtk_label_get_text(c);
            if (txt && strcmp(txt, "Home") == 0)
                return TRUE;
        }
        if (has_home_label(c))
            return TRUE;
    }
    return FALSE;
}

static gboolean on_row_mapped(gpointer ihint, guint n_params, const gpointer params, gpointer data) {
    (void)ihint;
    (void)n_params;
    (void)data;
    gpointer row = api.g_value_get_object(params);
    if (!row)
        return TRUE;
    if (in_places_sidebar(row) && has_home_label(row))
        api.gtk_widget_set_visible(row, FALSE);
    return TRUE;
}

static gboolean install_hook_idle(gpointer data) {
    (void)data;
    if (!load_symbols())
        return FALSE;
    guint map_sig = api.g_signal_lookup("map", api.gtk_list_box_row_get_type());
    if (map_sig != 0)
        api.g_signal_add_emission_hook(map_sig, 0, on_row_mapped, NULL, NULL);
    return FALSE;
}

__attribute__((constructor))
static void kos_nautilus_init(void) {
    guint (*idle_add)(gboolean (*)(gpointer), gpointer) = dlsym(RTLD_DEFAULT, "g_idle_add");
    if (idle_add)
        idle_add(install_hook_idle, NULL);
}
