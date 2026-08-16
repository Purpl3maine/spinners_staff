(function () {
  // Live-ticking clock on the staff clock-in page.
  var el = document.getElementById('live-clock');
  if (el) {
    function tick() {
      var now = new Date();
      el.textContent = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    tick();
    setInterval(tick, 1000);
  }

  // Confirm before destructive actions marked with data-confirm.
  document.addEventListener('submit', function (e) {
    var msg = e.target.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) {
      e.preventDefault();
    }
  });

  // Show/hide fields tagged data-paytype-field="hourly"/"salary" based on a
  // nearby <select name="payType">, so only the relevant pay fields show.
  document.querySelectorAll('select[name="payType"]').forEach(function (sel) {
    var form = sel.closest('form') || document;
    function update() {
      var val = sel.value;
      form.querySelectorAll('[data-paytype-field]').forEach(function (el) {
        el.style.display = el.getAttribute('data-paytype-field') === val ? '' : 'none';
      });
    }
    sel.addEventListener('change', update);
    update();
  });
})();
