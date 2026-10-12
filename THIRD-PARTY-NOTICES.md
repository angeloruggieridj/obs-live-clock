# Third-party notices

OBS Live Clock redistributes a small number of third-party assets. Their
licences and notices are listed here.

## Inter (font)

The presenter, dock and control views bundle the **Inter** typeface as web
font files (`.woff2`). The files are taken from the
[`@fontsource/inter`](https://www.npmjs.com/package/@fontsource/inter) npm
package, version **5.3.0**, which repackages the upstream Inter release from
<https://github.com/rsms/inter>.

Inter is licensed under the **SIL Open Font License, Version 1.1**
(SPDX: `OFL-1.1`).

Copyright (c) 2016 The Inter Project Authors (https://github.com/rsms/inter)

The SIL Open Font License permits the font to be used, studied, modified and
redistributed freely, including bundling and embedding it in software, as long
as the font is not sold by itself and derivative works are not distributed
under the font's Reserved Font Name. The full licence text and a FAQ are
available at <https://openfontlicense.org>.

## doctest (C++ test framework, plugin tests only)

`plugin/third_party/doctest/doctest.h`, version **2.4.11**, Copyright (c) 2016-2023 Viktor Kirilov, **MIT** (SPDX: `MIT`). Used only to build the plugin's unit tests; not part of the shipped plugin. Licence text: `plugin/third_party/doctest/LICENSE.txt`.

## nlohmann/json (C++ JSON library, linked into the plugin)

`plugin/third_party/nlohmann/json.hpp`, version **3.11.3**, Copyright (c) 2013-2022 Niels Lohmann, **MIT** (SPDX: `MIT`). Linked into the OBS plugin to read and write JSON. Licence text: `plugin/third_party/nlohmann/LICENSE.MIT`.
