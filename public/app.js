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

  // Geofenced clock in/out: grab the device's location before submitting,
  // so the server can check the staff member is actually at the pub.
  var geoForm = document.querySelector('[data-geo-form]');
  var geoBtn = document.getElementById('clock-submit-btn');
  var geoStatus = document.getElementById('clock-geo-status');
  if (geoForm && geoBtn) {
    var geoDefaultMsg = geoStatus ? geoStatus.textContent : '';
    geoBtn.addEventListener('click', function () {
      if (!('geolocation' in navigator)) {
        if (geoStatus) {
          geoStatus.textContent = "Your browser doesn't support location, so we can't check you're at the pub. Please ask your manager for help.";
          geoStatus.className = 'geo-status error';
        }
        return;
      }
      geoBtn.disabled = true;
      var originalLabel = geoBtn.textContent;
      geoBtn.textContent = 'Checking your location…';
      if (geoStatus) {
        geoStatus.textContent = 'Checking your location…';
        geoStatus.className = 'geo-status';
      }
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          geoForm.querySelector('input[name="lat"]').value = pos.coords.latitude;
          geoForm.querySelector('input[name="lng"]').value = pos.coords.longitude;
          geoForm.submit();
        },
        function (err) {
          geoBtn.disabled = false;
          geoBtn.textContent = originalLabel;
          var msg = 'Could not get your location. Please try again.';
          if (err && err.code === err.PERMISSION_DENIED) {
            msg = 'Location permission is needed to clock in/out. Please allow location access for this site in your browser settings, then try again.';
          } else if (err && err.code === err.TIMEOUT) {
            msg = 'Getting your location took too long. Please try again — make sure location services are turned on.';
          } else if (err && err.code === err.POSITION_UNAVAILABLE) {
            msg = "Your device couldn't determine its location. Please try again, ideally outdoors or near a window.";
          }
          if (geoStatus) {
            geoStatus.textContent = msg;
            geoStatus.className = 'geo-status error';
          }
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    });
  }

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
