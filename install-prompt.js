(function () {
  'use strict';

  // Ja rodando como app instalado (Android/Chrome ou iOS) — nada a fazer.
  if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) return;
  if (localStorage.getItem('pp-install-dismissed')) return;

  var ua = navigator.userAgent;
  var isIOS = /iPhone|iPad|iPod/i.test(ua) && !window.MSStream;
  var isIOSSafari = isIOS && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua);
  var isAndroid = /Android/i.test(ua);

  if (!isIOS && !isAndroid) return;

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  }

  function dismiss(banner) {
    banner.remove();
    localStorage.setItem('pp-install-dismissed', '1');
  }

  function buildBanner(text, showInstallBtn) {
    var banner = document.createElement('div');
    banner.id = 'pp-install-banner';
    banner.innerHTML =
      '<img src="/icon-192.png" alt="">' +
      '<span>' + text + '</span>' +
      (showInstallBtn ? '<button id="pp-install-btn" type="button">Adicionar</button>' : '') +
      '<button id="pp-install-close" type="button" aria-label="Fechar">&times;</button>';
    document.body.appendChild(banner);
    banner.classList.add('pp-show');
    banner.querySelector('#pp-install-close').addEventListener('click', function () { dismiss(banner); });
    return banner;
  }

  // Android/Chrome: evento nativo, dispara o dialogo real de instalacao.
  if (isAndroid) {
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      var banner = buildBanner('Instale o Promopobre no seu celular para acessar mais rapido', true);
      banner.querySelector('#pp-install-btn').addEventListener('click', function () {
        dismiss(banner);
        e.prompt();
      });
    });
  // iOS/Safari: nao existe API de instalacao, so instrucao manual.
  } else if (isIOSSafari) {
    buildBanner('Adicione o Promopobre a tela de inicio: toque em Compartilhar e depois em "Adicionar a Tela de Inicio"', false);
  }
})();
