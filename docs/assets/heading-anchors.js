// Discreet anchor links on headings — appears on hover only.
(function () {
  var headings = document.querySelectorAll('.content h2[id], .content h3[id], .content h4[id]');
  headings.forEach(function (h) {
    var a = document.createElement('a');
    a.href = '#' + h.id;
    a.className = 'heading-anchor';
    a.setAttribute('aria-label', 'Link to this section');
    a.textContent = '#';
    h.appendChild(a);
  });
})();
