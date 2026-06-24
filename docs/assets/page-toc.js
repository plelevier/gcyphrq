// Page TOC — builds a sticky sidebar from h2 headings and highlights the active section.
(function () {
  var toc = document.getElementById('page-toc');
  if (!toc) return;

  var headings = document.querySelectorAll('.content h2[id]');
  if (headings.length < 3) {
    toc.style.display = 'none';
    return;
  }

  var list = toc.querySelector('.page-toc__list');
  if (!list) return;

  headings.forEach(function (h) {
    var li = document.createElement('li');
    var a = document.createElement('a');
    a.href = '#' + h.id;
    a.textContent = h.textContent;
    li.appendChild(a);
    list.appendChild(li);
  });

  // Smooth scroll on click
  list.addEventListener('click', function (e) {
    var a = e.target.closest('a[href^="#"]');
    if (!a) return;
    e.preventDefault();
    var target = document.querySelector(a.getAttribute('href'));
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // IntersectionObserver for active highlight
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        var id = entry.target.id;
        var activeLink = list.querySelector('a[href="#' + id + '"]');
        if (activeLink) {
          list.querySelectorAll('li').forEach(function (li) { li.classList.remove('active'); });
          activeLink.parentElement.classList.add('active');
          var liRect = activeLink.parentElement.getBoundingClientRect();
          var tocRect = toc.getBoundingClientRect();
          if (liRect.bottom > tocRect.bottom || liRect.top < tocRect.top) {
            activeLink.parentElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }
      }
    });
  }, { rootMargin: '-80px 0px -60% 0px', threshold: 0 });

  headings.forEach(function (h) { observer.observe(h); });
})();
