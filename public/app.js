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

  // "Add to Home Screen" nudge: show the right instructions for the device,
  // hide it entirely if the app is already installed/running standalone,
  // and remember a dismissal so it doesn't nag every visit.
  var installTip = document.querySelector('[data-install-tip]');
  if (installTip) {
    var standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
    if (standalone || window.navigator.standalone) {
      installTip.remove();
    } else {
      var ua = navigator.userAgent || '';
      var platform = /iphone|ipad|ipod/i.test(ua) ? 'ios' : /android/i.test(ua) ? 'android' : 'desktop';
      installTip.querySelectorAll('[data-platform]').forEach(function (el) {
        el.style.display = el.getAttribute('data-platform') === platform ? '' : 'none';
      });
      var dismissBtn = installTip.querySelector('[data-install-tip-dismiss]');
      if (dismissBtn) {
        dismissBtn.addEventListener('click', function () {
          document.cookie = 'pubshift_hide_install_tip=1; Path=/; Max-Age=31536000; SameSite=Lax';
          installTip.remove();
        });
      }
    }
  }

  // Rota builder: drag-and-drop to move a shift, and copy/paste a shift
  // onto another day/person. Desktop-oriented (native HTML5 drag-and-drop
  // doesn't work reliably with touch) — on mobile, editing a shift the
  // normal way (tap it) still works fine.
  var rotaTable = document.querySelector('.rota-grid[data-week]');
  if (rotaTable) {
    var rotaWeek = rotaTable.getAttribute('data-week');
    var CLIPBOARD_KEY = 'pubshift_shift_clipboard';
    var clipboardBar = document.getElementById('shift-clipboard-bar');
    var pasteButtons = document.querySelectorAll('.paste-shift-btn');

    function getClipboard() {
      try {
        var raw = localStorage.getItem(CLIPBOARD_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    }
    function setClipboard(shift) {
      try {
        localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(shift));
      } catch (e) {}
    }
    function clearClipboard() {
      try {
        localStorage.removeItem(CLIPBOARD_KEY);
      } catch (e) {}
    }

    function refreshClipboardUI() {
      var clip = getClipboard();
      if (clip && clipboardBar) {
        clipboardBar.style.display = '';
        clipboardBar.innerHTML =
          'Copied: ' + clip.start + '–' + clip.end + ' · ' + clip.role +
          ' — click "📋 Paste shift" on any day to place it there. ';
        var clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'link-btn-plain';
        clearBtn.textContent = 'Clear';
        clearBtn.addEventListener('click', function () {
          clearClipboard();
          refreshClipboardUI();
        });
        clipboardBar.appendChild(clearBtn);
      } else if (clipboardBar) {
        clipboardBar.style.display = 'none';
        clipboardBar.innerHTML = '';
      }
      pasteButtons.forEach(function (btn) {
        btn.style.display = clip ? '' : 'none';
      });
    }
    refreshClipboardUI();

    function postShift(fields, done, url) {
      fetch(url || '/manager/rota/shift', {
        method: 'POST',
        headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
      })
        .then(done)
        .catch(done);
    }

    document.querySelectorAll('.chip-copy-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var wrap = btn.closest('[data-shift]');
        if (!wrap) return;
        try {
          setClipboard(JSON.parse(wrap.getAttribute('data-shift')));
          refreshClipboardUI();
        } catch (err) {}
      });
    });

    pasteButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var clip = getClipboard();
        if (!clip) return;
        postShift(
          {
            userId: btn.getAttribute('data-userid'),
            date: btn.getAttribute('data-date'),
            week: rotaWeek,
            start: clip.start,
            end: clip.end,
            role: clip.role,
            breakMinutes: clip.breakMinutes || 0,
            notes: clip.notes || '',
          },
          function () {
            window.location.reload();
          }
        );
      });
    });

    var SHIFT_MIME = 'application/x-pubshift-shift';
    var STAFFROW_MIME = 'application/x-pubshift-staffrow';

    document.querySelectorAll('.shift-chip-wrap[draggable="true"]').forEach(function (wrap) {
      wrap.addEventListener('dragstart', function (e) {
        var raw = wrap.getAttribute('data-shift');
        if (!raw) return;
        e.dataTransfer.setData(SHIFT_MIME, raw);
        e.dataTransfer.effectAllowed = 'move';
        e.stopPropagation();
      });
    });

    document.querySelectorAll('.rota-cell[data-userid]').forEach(function (cell) {
      cell.addEventListener('dragover', function (e) {
        if (e.dataTransfer.types.indexOf(SHIFT_MIME) === -1) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        cell.classList.add('drag-over');
      });
      cell.addEventListener('dragleave', function () {
        cell.classList.remove('drag-over');
      });
      cell.addEventListener('drop', function (e) {
        if (e.dataTransfer.types.indexOf(SHIFT_MIME) === -1) return;
        e.preventDefault();
        cell.classList.remove('drag-over');
        var raw = e.dataTransfer.getData(SHIFT_MIME);
        if (!raw) return;
        var shift;
        try {
          shift = JSON.parse(raw);
        } catch (err) {
          return;
        }
        var targetUserId = cell.getAttribute('data-userid');
        var targetDate = cell.getAttribute('data-date');
        if (shift.userId === targetUserId && shift.date === targetDate) return; // dropped back where it started
        postShift(
          {
            id: shift.id,
            userId: targetUserId,
            date: targetDate,
            week: rotaWeek,
            start: shift.start,
            end: shift.end,
            role: shift.role,
            breakMinutes: shift.breakMinutes || 0,
            notes: shift.notes || '',
          },
          function () {
            window.location.reload();
          }
        );
      });
    });

    // Drag the ⋮⋮ handle on a staff row to reorder them (within their
    // department group — dropping onto a row from a different group is a
    // no-op, enforced server-side too).
    document.querySelectorAll('tr[data-user-id]').forEach(function (row) {
      var handle = row.querySelector('.row-drag-handle');
      if (handle) {
        handle.addEventListener('dragstart', function (e) {
          e.dataTransfer.setData(STAFFROW_MIME, row.getAttribute('data-user-id'));
          e.dataTransfer.effectAllowed = 'move';
          e.stopPropagation();
        });
      }
      row.addEventListener('dragover', function (e) {
        if (e.dataTransfer.types.indexOf(STAFFROW_MIME) === -1) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        row.classList.add('row-drag-over');
      });
      row.addEventListener('dragleave', function () {
        row.classList.remove('row-drag-over');
      });
      row.addEventListener('drop', function (e) {
        if (e.dataTransfer.types.indexOf(STAFFROW_MIME) === -1) return;
        e.preventDefault();
        row.classList.remove('row-drag-over');
        var draggedUserId = e.dataTransfer.getData(STAFFROW_MIME);
        var targetUserId = row.getAttribute('data-user-id');
        if (!draggedUserId || draggedUserId === targetUserId) return;
        var rect = row.getBoundingClientRect();
        var position = e.clientY - rect.top < rect.height / 2 ? 'before' : 'after';
        postShift(
          { draggedUserId: draggedUserId, targetUserId: targetUserId, position: position, week: rotaWeek },
          function () {
            window.location.reload();
          },
          '/manager/rota/staff/reorder'
        );
      });
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
