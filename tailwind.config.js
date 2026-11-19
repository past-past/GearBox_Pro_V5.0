/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/renderer/index.html',
    './src/renderer/desktop-bridge.js'
  ],
  safelist: [
    // 动态切换的状态色与按钮样式，确保离线编译完整包含
    'bg-sky-500/20', 'text-sky-300', 'border-sky-500/40',
    'bg-emerald-500/20', 'text-emerald-300', 'border-emerald-500/40',
    'bg-amber-500/20', 'text-amber-300', 'border-amber-500/40',
    'bg-rose-500/20', 'text-rose-300', 'border-rose-500/40',
    'bg-amber-600', 'bg-sky-600', 'bg-emerald-600', 'bg-teal-600', 'bg-indigo-600',
    'text-white', 'text-slate-300', 'text-slate-400', 'hidden'
  ],
  theme: {
    extend: {}
  },
  plugins: []
};
