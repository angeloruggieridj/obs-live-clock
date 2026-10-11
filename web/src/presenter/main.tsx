// SPDX-License-Identifier: GPL-2.0-or-later
import { createRoot } from 'react-dom/client';
import '../ui/fonts';
import '../ui/base.css';
import './presenter.css';
import { browserFrameLoop } from '../core/frame-loop';
import { parseParams } from '../core/params';
import { LiveClient, wsUrl } from '../core/ws-client';
import { LiveProvider } from '../ui/live-context';
import { installTokens } from '../ui/tokens';
import { PresenterScreen } from './PresenterScreen';
import { keepScreenAwake } from './wake-lock';

const params = parseParams(location.search);
installTokens();
document.documentElement.lang = params.lang;
document.title = params.screen === null ? 'OBS Live Clock · Presenter' : `OBS Live Clock · Presenter · ${params.screen}`;

const client = new LiveClient({ url: wsUrl(location), role: 'presenter' });
client.start();
keepScreenAwake();

createRoot(document.getElementById('root')!).render(
  <LiveProvider store={client} frames={browserFrameLoop()} lang={params.lang}>
    <PresenterScreen />
  </LiveProvider>,
);
