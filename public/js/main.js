// Sidebar Toggle
const sidebarToggle = document.getElementById('sidebarToggle');
const sidebar = document.getElementById('sidebar');

if (sidebarToggle && sidebar) {
  sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    sidebar.classList.toggle('open');
  });
}

// Active nav link
const currentPath = window.location.pathname;
document.querySelectorAll('.sidebar-nav a').forEach(link => {
  if (link.getAttribute('href') === currentPath) {
    link.classList.add('active');
  }
});

// Auto dismiss flash message alerts after 4 seconds (exclude permanent cards and receipt banners)
setTimeout(() => {
  document.querySelectorAll('.alert.alert-dismissible:not(.alert-permanent)').forEach(alert => {
    const bsAlert = bootstrap.Alert.getOrCreateInstance(alert);
    if (bsAlert) bsAlert.close();
  });
}, 4000);

// Confirm delete forms
document.querySelectorAll('form[onsubmit]').forEach(form => {
  // already handled inline
});
