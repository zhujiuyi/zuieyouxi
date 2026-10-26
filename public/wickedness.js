// The physical dial has 6/4 on its front and 2/0 on its reverse.
// The number at the bottom is the value facing its owner.
export function wickednessPanel(stage, { finished = false, winner = false } = {}) {
  const value = [6, 4, 2, 0].includes(stage) ? stage : 6;
  const reverse = value <= 2;
  const vertical = reverse ? 2 : 6, horizontal = reverse ? 0 : 4;
  const angle = value === 4 || value === 0 ? 90 : 0;
  const description = finished ? (winner ? '已完成救赎' : '本局已结束') : value === 0 ? '决胜阶段 · 清空手牌获胜' : `再清空 ${value / 2} 次手牌`;
  return `<aside class="wickedness-panel" role="group" aria-label="你的罪恶值，当前 ${value}" data-wickedness="${value}">
    <div class="wickedness-token" aria-hidden="true">
      <svg class="wickedness-dial" viewBox="0 0 220 220" focusable="false">
        <defs>
          <linearGradient id="dial-purple" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#8c589d"/><stop offset=".42" stop-color="#68377f"/><stop offset="1" stop-color="#40234e"/></linearGradient>
          <linearGradient id="dial-edge" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#c6a2c9"/><stop offset=".4" stop-color="#74427f"/><stop offset="1" stop-color="#332138"/></linearGradient>
          <linearGradient id="dial-sheen" x1="0" y1="0" x2=".85" y2="1"><stop stop-color="#fff" stop-opacity=".16"/><stop offset=".46" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".1"/></linearGradient>
          <clipPath id="dial-illustration"><path d="M110 48 174 110 110 172 46 110Z"/></clipPath>
        </defs>
        <g class="wickedness-dial-face" transform="rotate(${angle} 110 110)">
          <path d="M116 12 212 108Q218 114 212 120L120 212Q114 218 108 212L12 116Q6 110 12 104L104 12Q110 6 116 12Z" fill="#1b1122" transform="translate(0 4)"/>
          <path d="M116 8 212 104Q218 110 212 116L116 212Q110 218 104 212L8 116Q2 110 8 104L104 8Q110 2 116 8Z" fill="url(#dial-edge)" stroke="#b48db8" stroke-width="1.2"/>
          <path d="M114 12 208 106Q212 110 208 114L114 208Q110 212 106 208L12 114Q8 110 12 106L106 12Q110 8 114 12Z" fill="url(#dial-purple)" stroke="#33203f" stroke-opacity=".7"/>
          <path d="M110 48 174 110 110 172 46 110Z" fill="#67417b"/>
          <image href="/assets/pride.webp" x="45" y="48" width="130" height="126" preserveAspectRatio="xMidYMid slice" clip-path="url(#dial-illustration)"/>
          <g fill="#dfc09b" opacity=".7"><path d="m63 79 2-5 2 5 5 2-5 2-2 5-2-5-5-2Z"/><path d="m145 137 2-5 2 5 5 2-5 2-2 5-2-5-5-2Z"/><path d="m139 65 1-3 1 3 3 1-3 1-1 3-1-3-3-1Z"/><path d="m77 141 1-3 1 3 3 1-3 1-1 3-1-3-3-1Z"/></g>
          <g class="dial-number dial-number-ivory" text-anchor="middle" dominant-baseline="central">
            <text x="110" y="37" transform="rotate(180 110 37)">${vertical}</text>
            <text x="110" y="183">${vertical}</text>
          </g>
          <g class="dial-number dial-number-gold" text-anchor="middle" dominant-baseline="central">
            <text x="37" y="110" transform="rotate(90 37 110)">${horizontal}</text>
            <text x="183" y="110" transform="rotate(-90 183 110)">${horizontal}</text>
          </g>
          <path d="M114 12 208 106Q212 110 208 114L114 208Q110 212 106 208L12 114Q8 110 12 106L106 12Q110 8 114 12Z" fill="url(#dial-sheen)"/>
        </g>
      </svg>
      <span class="wickedness-facing" title="朝向你的数字就是当前罪恶值"></span>
    </div>
    <div class="wickedness-caption" aria-live="polite" aria-atomic="true">
      <h2>你的罪恶值</h2>
      <p class="wickedness-readout">当前 <strong>${value}</strong></p>
      <p class="wickedness-description">${description}</p>
    </div>
  </aside>`;
}
