(() => {
  try {
    const theme = localStorage.getItem("contextlens_theme");
    if (theme === "light" || theme === "dark") {
      document.documentElement.setAttribute("data-theme", theme);
    }
  } catch {
    // Keep the CSS fallback if localStorage is unavailable.
  }
})();
