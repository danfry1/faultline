/* ── Sidebar scroll sync ───────────────────────────────── */

(function setupDocsSidebar() {
  const nav = document.querySelector('.docs-nav');
  if (!nav) return;

  const links = Array.from(nav.querySelectorAll('a[href^="#"]'));
  const targets = links
    .map(function (link) {
      return {
        link: link,
        target: document.getElementById(link.getAttribute('href').slice(1)),
      };
    })
    .filter(function (entry) {
      return entry.target;
    });

  if (targets.length === 0) return;

  var observer = new IntersectionObserver(
    function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          for (var j = 0; j < targets.length; j++) {
            targets[j].link.classList.remove('is-active');
          }
          var match = targets.find(function (t) {
            return t.target === entries[i].target;
          });
          if (match) match.link.classList.add('is-active');
        }
      }
    },
    { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
  );

  for (var k = 0; k < targets.length; k++) {
    observer.observe(targets[k].target);
  }
})();

/* ── Mobile drawer ─────────────────────────────────────── */

(function setupMobileDrawer() {
  var toggle = document.querySelector('.docs-drawer-toggle');
  var sidebar = document.querySelector('.docs-sidebar');
  var overlay = document.querySelector('.docs-drawer-overlay');

  if (!toggle || !sidebar || !overlay) return;

  function openDrawer() {
    sidebar.classList.add('is-open');
    overlay.classList.add('is-open');
  }

  function closeDrawer() {
    sidebar.classList.remove('is-open');
    overlay.classList.remove('is-open');
  }

  toggle.addEventListener('click', function () {
    if (sidebar.classList.contains('is-open')) {
      closeDrawer();
    } else {
      openDrawer();
    }
  });

  overlay.addEventListener('click', closeDrawer);

  // Close drawer when a link inside the sidebar is clicked
  sidebar.addEventListener('click', function (e) {
    if (e.target.tagName === 'A') {
      closeDrawer();
    }
  });
})();
