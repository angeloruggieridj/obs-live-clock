// SPDX-License-Identifier: GPL-2.0-or-later
import { createRoot } from 'react-dom/client';
import '../ui/fonts';
import '../ui/base.css';
import '../ui/control/panels.css';
import './dock.css';
import { browserFrameLoop } from '../core/frame-loop';
import { parseParams } from '../core/params';
import { LiveClient, wsUrl } from '../core/ws-client';
import { LiveProvider } from '../ui/live-context';
import { installTokens } from '../ui/tokens';
import { DockScreen } from './DockScreen';

const params = parseParams(location.search);
installTokens();
document.documentElement.lang = params.lang;

const client = new LiveClient({ url: wsUrl(location), role: 'control' });
client.start();

createRoot(document.getElementById('root')!).render(
  <LiveProvider store={client} frames={browserFrameLoop()} lang={params.lang}>
    <DockScreen />
  </LiveProvider>,
);
