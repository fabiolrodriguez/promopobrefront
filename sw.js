// Service worker minimo: existe apenas para satisfazer o criterio de
// instalabilidade do Chrome/Android (beforeinstallprompt exige um SW
// registrado com handler de fetch). Nao faz cache, nao intercepta nada.
self.addEventListener('fetch', function () {});
