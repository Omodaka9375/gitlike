// ---------------------------------------------------------------------------
// Prism.js — Bundled with language plugins.
// Imported once to register all grammars; exposes Prism on window.
// ---------------------------------------------------------------------------

import Prism from 'prismjs';

import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-solidity';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-json';

// Expose globally for views.ts `window.Prism.highlightElement()`
(window as unknown as { Prism: typeof Prism }).Prism = Prism;
