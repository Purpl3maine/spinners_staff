(function () {
  // Keeps the rota grid's sticky day header positioned just below the
  // sticky top bar rather than directly underneath it (where it'd be
  // hidden) — measured live since the top bar's height varies (its nav row
  // wraps onto a second line on narrow screens).
  var topbar = document.querySelector('.topbar');
  if (topbar) {
    var syncTopbarHeight = function () {
      document.documentElement.style.setProperty('--topbar-h', topbar.offsetHeight + 'px');
    };
    syncTopbarHeight();
    window.addEventListener('resize', syncTopbarHeight);
  }

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
          ' — click "📋 Paste shift" on a day to place it there (one paste, then copy again to repeat). ';
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

    // When a drag or paste hands a shift to a DIFFERENT staff member than it
    // started with, the role/section should switch to reflect the new
    // person's own position (e.g. dragging a "Kitchen" shift onto a
    // bartender shouldn't leave it labelled "Kitchen") rather than carrying
    // over the original person's role. Only kicks in when the person
    // actually changes — moving your own shift to another day, or an open
    // (unassigned) shift with no target person, keeps its original role
    // untouched, since that's not a reassignment.
    function roleForTarget(sourceUserId, sourceRole, targetUserId) {
      if (!targetUserId || targetUserId === sourceUserId) return sourceRole;
      var row = document.querySelector('tr[data-user-id="' + targetUserId + '"]');
      var position = row ? row.getAttribute('data-position') : '';
      return position ? position : sourceRole;
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
        // Clear the clipboard as soon as it's used, so "Paste shift" only
        // offers a one-time paste rather than staying available to spam
        // the same shift onto multiple days.
        clearClipboard();
        var pasteTargetUserId = btn.getAttribute('data-userid');
        postShift(
          {
            userId: pasteTargetUserId,
            date: btn.getAttribute('data-date'),
            week: rotaWeek,
            start: clip.start,
            end: clip.end,
            role: roleForTarget(clip.userId, clip.role, pasteTargetUserId),
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
            role: roleForTarget(shift.userId, shift.role, targetUserId),
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

  // Clock in/out reminder push notifications: reveal the opt-in card only
  // if the browser actually supports push (iOS Safari in a normal tab
  // doesn't, for example — only once added to the Home Screen), then wire
  // up subscribe/unsubscribe.
  var pushCard = document.querySelector('[data-push-card]');
  var pushToggle = document.querySelector('[data-push-toggle]');
  if (pushCard && pushToggle && 'serviceWorker' in navigator && 'PushManager' in window) {
    pushCard.style.display = '';

    function urlBase64ToUint8Array(base64String) {
      var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
      var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
      var rawData = window.atob(base64);
      var outputArray = new Uint8Array(rawData.length);
      for (var i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
      return outputArray;
    }

    pushToggle.addEventListener('click', function () {
      var subscribed = pushToggle.getAttribute('data-subscribed') === 'true';
      pushToggle.disabled = true;

      if (subscribed) {
        navigator.serviceWorker.ready
          .then(function (reg) {
            return reg.pushManager.getSubscription();
          })
          .then(function (sub) {
            if (!sub) return null;
            var endpoint = sub.endpoint;
            return sub.unsubscribe().then(function () {
              return fetch('/staff/push-unsubscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'endpoint=' + encodeURIComponent(endpoint),
              });
            });
          })
          .then(function () {
            window.location.reload();
          })
          .catch(function () {
            pushToggle.disabled = false;
          });
        return;
      }

      navigator.serviceWorker
        .register('/sw.js')
        .then(function () {
          return navigator.serviceWorker.ready;
        })
        .then(function (reg) {
          return reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(pushToggle.getAttribute('data-vapid-key')),
          });
        })
        .then(function (sub) {
          return fetch('/staff/push-subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sub),
          });
        })
        .then(function () {
          window.location.reload();
        })
        .catch(function () {
          pushToggle.disabled = false;
          window.alert("Couldn't turn on reminders — check that notifications aren't blocked for this site in your browser settings, then try again.");
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
