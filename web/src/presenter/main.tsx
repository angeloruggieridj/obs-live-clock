// SPDX-License-Identifier: GPL-2.0-or-later
import { createRoot } from 'react-dom/client';
import '../ui/fonts';
import '../ui/base.css';
import { installTokens } from '../ui/tokens';

installTokens();
createRoot(document.getElementById('root')!).render(<p>OBS Live Clock</p>);
