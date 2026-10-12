// SPDX-License-Identifier: GPL-2.0-or-later
import { createRoot } from 'react-dom/client';
import '../ui/fonts';
import '../ui/base.css';
import './styles/editor.css';
import { parseParams } from '../core/params';
import { installTokens } from '../ui/tokens';
import { EditorApp } from './EditorApp';

const params = parseParams(location.search);
installTokens();
document.documentElement.lang = params.lang;

createRoot(document.getElementById('root')!).render(<EditorApp lang={params.lang} />);
