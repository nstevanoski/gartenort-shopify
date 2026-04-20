/**
 * Cart upsell:
 * - AJAX cart: intercepts theme.Product._showCartPopup after /cart/add.js
 * - Non-AJAX (redirect) cart: captures product form submit, adds via Ajax API, then shows upsell before cart redirect
 */
(function () {
  if (typeof theme === 'undefined' || !theme.Currency) {
    return;
  }

  var cfg = theme.cartUpsell;
  if (!cfg || !cfg.enabled) {
    return;
  }

  var popupEl = document.querySelector('[data-cart-upsell-popup]');
  if (!popupEl) {
    return;
  }

  var selectEl = popupEl.querySelector('[data-cart-upsell-variant-select]');
  var priceEl = popupEl.querySelector('[data-cart-upsell-price]');
  var compareEl = popupEl.querySelector('[data-cart-upsell-compare]');
  var ctaEl = popupEl.querySelector('[data-cart-upsell-add]');
  var errorEl = popupEl.querySelector('[data-cart-upsell-error]');
  var closeEls = popupEl.querySelectorAll(
    '[data-cart-upsell-close], [data-cart-upsell-decline]'
  );

  var flowFromNonAjaxForm = false;
  var postUpsellRedirectUrl = '';

  var pendingSelf = null;
  var pendingOrigShow = null;

  function getCartRoutes() {
    var el = document.querySelector('[data-cart-routes]');
    if (!el) {
      return { cartUrl: '/cart', cartAddUrl: '/cart/add' };
    }
    try {
      return JSON.parse(el.textContent);
    } catch (e) {
      return { cartUrl: '/cart', cartAddUrl: '/cart/add' };
    }
  }

  function getDefaultCartUrl() {
    var r = getCartRoutes();
    return (r && r.cartUrl) || '/cart';
  }

  function getCartAddJsUrl() {
    var r = getCartRoutes();
    var base = (r && r.cartAddUrl) || '/cart/add';
    return base + (base.indexOf('.js') !== -1 ? '' : '.js');
  }

  function getRedirectUrlAfterAdd(form) {
    if (!form) {
      return getDefaultCartUrl();
    }
    var input = form.querySelector('input[name="return_to"]');
    if (input && input.value) {
      return input.value;
    }
    return getDefaultCartUrl();
  }

  function getLineHandle(lineItem) {
    if (!lineItem) {
      return '';
    }
    if (lineItem.handle) {
      return lineItem.handle;
    }
    if (lineItem.product_handle) {
      return lineItem.product_handle;
    }
    return cfg.currentProductHandle || '';
  }

  function shouldOffer(config, lineItem) {
    var addedHandle = getLineHandle(lineItem);
    if (addedHandle && addedHandle === config.upsellHandle) {
      return false;
    }
    if (!addedHandle && cfg.currentProductHandle === config.upsellHandle) {
      return false;
    }
    return true;
  }

  function cartHasProductId(cart, productId) {
    if (!cart || !cart.items || !productId) {
      return false;
    }
    return cart.items.some(function (i) {
      return Number(i.product_id) === Number(productId);
    });
  }

  function formatMoney(cents) {
    return theme.Currency.formatMoney(cents, theme.moneyFormat);
  }

  function updateVariantDisplay() {
    if (!selectEl || !priceEl || !ctaEl) {
      return;
    }
    var opt = selectEl.options[selectEl.selectedIndex];
    if (!opt) {
      return;
    }
    var fullCents = parseInt(opt.getAttribute('data-price'), 10) || 0;
    var offerAttr = opt.getAttribute('data-offer-cents');
    var offerCents =
      offerAttr !== null && offerAttr !== ''
        ? parseInt(offerAttr, 10)
        : Math.round(fullCents / 2);
    priceEl.textContent = formatMoney(offerCents);
    if (compareEl) {
      compareEl.textContent = formatMoney(fullCents);
      compareEl.hidden = false;
      compareEl.classList.remove('hide');
    }
    ctaEl.textContent = 'Ja, für ' + formatMoney(offerCents) + ' hinzufügen →';
  }

  if (selectEl) {
    selectEl.addEventListener('change', updateVariantDisplay);
  }

  function syncCartCountDom(cart) {
    var countEl = document.querySelector('[data-cart-count]');
    var bubble = document.querySelector('[data-cart-count-bubble]');
    var cartPopupQty = document.querySelector('[data-cart-popup-cart-quantity]');
    if (countEl) {
      countEl.textContent = cart.item_count;
    }
    if (bubble && cart.item_count > 0) {
      bubble.classList.remove('hide');
    }
    if (cartPopupQty) {
      cartPopupQty.textContent = cart.item_count;
    }
  }

  function clearError() {
    if (errorEl) {
      errorEl.textContent = '';
    }
  }

  function clearButtonLoading(btn) {
    if (!btn) {
      return;
    }
    btn.classList.remove('product-form__cart-submit--loading');
    btn.removeAttribute('aria-disabled');
    btn.removeAttribute('aria-busy');
    var textEl = btn.querySelector('[data-add-to-cart-text]');
    var loader = btn.querySelector('[data-loader]');
    if (textEl) {
      textEl.classList.remove('hide');
    }
    if (loader) {
      loader.classList.add('hide');
    }
  }

  function setButtonLoading(btn) {
    if (!btn) {
      return;
    }
    btn.classList.add('product-form__cart-submit--loading');
    btn.setAttribute('aria-disabled', 'true');
    btn.setAttribute('aria-busy', 'true');
    var textEl = btn.querySelector('[data-add-to-cart-text]');
    var loader = btn.querySelector('[data-loader]');
    if (textEl) {
      textEl.classList.add('hide');
    }
    if (loader) {
      loader.classList.remove('hide');
    }
  }

  function closeUpsellFocus() {
    if (typeof slate !== 'undefined' && slate.a11y) {
      slate.a11y.removeTrapFocus({
        container: popupEl,
        namespace: 'cartUpsellFocus'
      });
    }
    popupEl.hidden = true;
    document.removeEventListener('keyup', onKeyup);
  }

  function onKeyup(evt) {
    var esc =
      typeof slate !== 'undefined' &&
      slate.utils &&
      slate.utils.keyboardKeys &&
      slate.utils.keyboardKeys.ESCAPE;
    if (esc && evt.keyCode === esc) {
      handleDecline();
    }
  }

  function handleDecline() {
    clearError();
    closeUpsellFocus();

    if (flowFromNonAjaxForm) {
      window.location.assign(postUpsellRedirectUrl || getDefaultCartUrl());
      resetPendingFlow();
      return;
    }

    if (pendingSelf && pendingOrigShow) {
      pendingOrigShow.apply(pendingSelf, []);
    }
    resetPendingFlow();
  }

  function resetPendingFlow() {
    flowFromNonAjaxForm = false;
    postUpsellRedirectUrl = '';
    pendingSelf = null;
    pendingOrigShow = null;
  }

  function handleAdd() {
    if (!selectEl || !ctaEl) {
      return;
    }
    var opt = selectEl.options[selectEl.selectedIndex];
    if (!opt || opt.disabled) {
      return;
    }
    clearError();
    ctaEl.disabled = true;
    var vid = parseInt(opt.value, 10);
    var redirectAfterNonAjax = flowFromNonAjaxForm;

    fetch('/cart/add.js', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ id: vid, quantity: 1 }] })
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (json) {
        if (json.status && json.status !== 200) {
          throw new Error(json.description || theme.strings.cartError);
        }
        return fetch('/cart.js', { credentials: 'same-origin' }).then(function (r) {
          return r.json();
        });
      })
      .then(function (cart) {
        var restoreFocus = pendingSelf;
        syncCartCountDom(cart);
        closeUpsellFocus();
        if (redirectAfterNonAjax) {
          window.location.assign(postUpsellRedirectUrl || getDefaultCartUrl());
          resetPendingFlow();
          return;
        }
        pendingSelf = null;
        pendingOrigShow = null;
        if (restoreFocus && restoreFocus.previouslyFocusedElement) {
          restoreFocus.previouslyFocusedElement.focus();
        }
      })
      .catch(function (err) {
        if (errorEl) {
          errorEl.textContent =
            (err && err.message) || theme.strings.cartError;
        }
      })
      .then(function () {
        ctaEl.disabled = false;
      });
  }

  function openUpsell(productInstance, origShowFn, options) {
    options = options || {};
    pendingSelf = productInstance;
    pendingOrigShow = origShowFn;
    flowFromNonAjaxForm = !!options.fromNonAjaxForm;
    postUpsellRedirectUrl = options.redirectUrl || '';

    clearError();
    updateVariantDisplay();

    if (productInstance && productInstance._handleButtonLoadingState) {
      productInstance._handleButtonLoadingState(false);
    }

    popupEl.hidden = false;

    if (typeof slate !== 'undefined' && slate.a11y) {
      slate.a11y.trapFocus({
        container: popupEl,
        elementToFocus: selectEl || popupEl,
        namespace: 'cartUpsellFocus'
      });
    }

    document.addEventListener('keyup', onKeyup);
  }

  function runUpsellDecisionAfterAdd(lineItem, productInstance, origShowFn, options) {
    return fetch('/cart.js', { credentials: 'same-origin' })
      .then(function (r) {
        return r.json();
      })
      .then(function (cart) {
        if (cartHasProductId(cart, cfg.upsellProductId)) {
          if (origShowFn && productInstance) {
            origShowFn.apply(productInstance, []);
          } else if (options && options.onSkipUpsell) {
            options.onSkipUpsell();
          }
          return;
        }
        if (!shouldOffer(cfg, lineItem)) {
          if (origShowFn && productInstance) {
            origShowFn.apply(productInstance, []);
          } else if (options && options.onSkipUpsell) {
            options.onSkipUpsell();
          }
          return;
        }
        openUpsell(
          productInstance || makeStubFromOptions(options),
          origShowFn,
          options || {}
        );
      })
      .catch(function () {
        if (origShowFn && productInstance) {
          origShowFn.apply(productInstance, []);
        } else if (options && options.onSkipUpsell) {
          options.onSkipUpsell();
        }
      });
  }

  function makeStubFromOptions(options) {
    var o = options || {};
    return {
      previouslyFocusedElement: o.previousFocus || document.activeElement,
      _handleButtonLoadingState: function (loading) {
        var btn = o.submitButton;
        if (!btn) {
          return;
        }
        if (loading) {
          setButtonLoading(btn);
        } else {
          clearButtonLoading(btn);
        }
      }
    };
  }

  /** ---------- AJAX cart (theme.Product) ---------- */
  if (theme.Product) {
    var proto = theme.Product.prototype;
    if (!proto.__cartUpsellPatched) {
      proto.__cartUpsellPatched = true;

      var origUpdate = proto._updateCartPopupContent;
      proto._updateCartPopupContent = function (item) {
        this.__cartUpsellLineItem = item;
        return origUpdate.apply(this, arguments);
      };

      var origShow = proto._showCartPopup;
      proto._showCartPopup = function () {
        var self = this;
        var lineItem = this.__cartUpsellLineItem;

        if (!cfg.ajaxCartEnabled) {
          return origShow.apply(this, arguments);
        }

        return runUpsellDecisionAfterAdd(lineItem, self, origShow, null);
      };
    }
  }

  /** ---------- Non-AJAX: full-page cart redirect ---------- */
  if (!cfg.ajaxCartEnabled && theme.Helpers && theme.Helpers.serialize) {
    document.addEventListener(
      'submit',
      function (evt) {
        var form = evt.target;
        if (!form || form.tagName !== 'FORM') {
          return;
        }
        if (!form.hasAttribute('data-product-form')) {
          return;
        }
        var inProductSection =
          form.closest('[data-section-type="product"]') ||
          form.closest('[data-section-type="product-template"]');
        if (!inProductSection) {
          return;
        }

        if (form.querySelector('[name="add"]') === null && !form.querySelector('button[name="add"]')) {
          return;
        }

        evt.preventDefault();
        evt.stopPropagation();

        var submitBtn =
          form.querySelector('button.product-form__cart-submit[name="add"]') ||
          form.querySelector('[data-add-to-cart]');
        var prevFocus = document.activeElement;
        if (submitBtn) {
          setButtonLoading(submitBtn);
        }

        var addUrl = getCartAddJsUrl();
        fetch(addUrl, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: theme.Helpers.serialize(form)
        })
          .then(function (response) {
            return response.json();
          })
          .then(function (json) {
            if (json.status && json.status !== 200) {
              var err = new Error(json.description || theme.strings.cartError);
              err.isFromServer = true;
              throw err;
            }
            return json;
          })
          .then(function (lineItem) {
            var redirectUrl = getRedirectUrlAfterAdd(form);
            return runUpsellDecisionAfterAdd(
              lineItem,
              null,
              null,
              {
                fromNonAjaxForm: true,
                redirectUrl: redirectUrl,
                previousFocus: prevFocus,
                submitButton: submitBtn,
                onSkipUpsell: function () {
                  clearButtonLoading(submitBtn);
                  window.location.assign(redirectUrl);
                }
              }
            ).then(function () {
              if (submitBtn) {
                clearButtonLoading(submitBtn);
              }
            });
          })
          .catch(function () {
            if (submitBtn) {
              clearButtonLoading(submitBtn);
            }
            if (prevFocus && prevFocus.focus) {
              prevFocus.focus();
            }
            if (typeof window.alert === 'function') {
              window.alert(theme.strings.cartError);
            }
          });

        return false;
      },
      true
    );
  }

  popupEl.addEventListener('click', function (evt) {
    if (evt.target === popupEl) {
      handleDecline();
    }
  });

  if (ctaEl) {
    ctaEl.addEventListener('click', handleAdd);
  }

  closeEls.forEach(function (btn) {
    btn.addEventListener('click', handleDecline);
  });
})();
