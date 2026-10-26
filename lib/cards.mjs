export const SUITS = ['pride', 'greed', 'lust', 'envy', 'wrath', 'gluttony', 'sloth'];
export const META = {
  pride: { name: '傲慢', english: 'PRIDE', color: '#a37bdb', short: '向对手询问傲慢', text: '询问一名对手是否有傲慢。对方展示傲慢则你摸 1 张；否则对方摸 1 张。展示不是强制的。' },
  greed: { name: '贪婪', english: 'GREED', color: '#e4b646', short: '发牌冒险，五张清手', text: '选择方向，逐张从牌堆向其他玩家明发。发出至少 2 张非贪婪且最后不是贪婪时可停；非贪婪同色重复或出现腐化则失败并收回全部牌。成功发出共 5 张则清空自己的手牌。' },
  lust: { name: '色欲', english: 'LUST', color: '#d8789c', short: '暗弃一张，试探对手', text: '指定一名对手决定是否参与。参与时双方可各暗弃 1 张，也可不弃，同时揭晓。每弃出一张色欲，对方摸 3 张。不能暗弃光环。' },
  envy: { name: '嫉妒', english: 'ENVY', color: '#9db65e', short: '摸两张，有机会换手', text: '摸 2 张牌。若手中没有嫉妒（腐化也算），可选择与一名对手交换全部手牌，也可保留。' },
  wrath: { name: '愤怒', english: 'WRATH', color: '#d97660', short: '先摸两张，再反击', text: '指定一名对手先摸 2 张。对方可弃一张愤怒（或腐化）令你摸 2 张，双方可反复反击，直到一方放弃或无牌反击。' },
  gluttony: { name: '暴食', english: 'GLUTTONY', color: '#c79569', short: '取一张或摸三张，再行动', text: '随机取得一名对手的 1 张手牌，或从牌堆摸 3 张。无论选哪一种，都额外获得一个回合。可连续发动。' },
  sloth: { name: '懒惰', english: 'SLOTH', color: '#78a9cf', short: '暂留面前，小心连锁', text: '将生效的懒惰留在自己面前，直到自己的下个回合开始时弃掉。其他玩家发动懒惰时，面前已有懒惰的玩家摸 1 张。腐化视作所有花色。' },
  purity: { name: '净化', english: 'PURITY', color: '#e1cf8e', short: '把光环收入手中', text: '将光环加入自己的手牌，即使光环在其他玩家手中也要取回。没有花色，数字为 0，可用于顺子。' },
  corruption: { name: '腐化', english: 'CORRUPTION', color: '#a39aaa', short: '七种花色，任选一种效果', text: '固定数字 8，同时属于七种花色。打出时选择一种罪孽效果；不能代替其他数字，也不能发动净化。' },
  halo: { name: '光环', english: 'HALO', color: '#edce77', short: '清空手牌，接近救赎', text: '单独打出，清空自己的全部手牌。光环回到桌面中央，不进入抽牌堆。没有花色，也没有数字。' }
};
export const CARDS = Object.fromEntries([
  ...SUITS.flatMap(suit => Array.from({ length: 7 }, (_, i) => ({ id: `${suit}-${i + 1}`, suit, value: i + 1 }))),
  { id: 'purity', suit: 'purity', value: 0 },
  { id: 'corruption', suit: 'corruption', value: 8 },
  { id: 'halo', suit: 'halo', value: null }
].map(c => [c.id, c]));
export const card = id => CARDS[id];
export const label = id => `${META[card(id).suit].name}${card(id).value ?? ''}`;
export const hasSuit = (id, suit) => card(id)?.suit === suit || card(id)?.suit === 'corruption';

// A meld can satisfy more than one rule; the chosen top must satisfy at least one.
export function meldOptions(ids) {
  if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !card(id))) return [];
  if (ids.length === 1) return [{ kind: '单张', tops: ids }];
  if (ids.includes('halo')) return [];
  const cards = ids.map(card), options = [];
  if (SUITS.some(s => ids.every(id => hasSuit(id, s)))) options.push({ kind: '同花色', tops: ids });
  if (cards.every(c => c.value === cards[0].value)) options.push({ kind: '同数字', tops: ids });
  const sorted = [...cards].sort((a, b) => a.value - b.value);
  if (sorted.every((c, i) => !i || c.value === sorted[i - 1].value + 1)) {
    options.push({ kind: '顺子', tops: [sorted.at(-1).id] });
  }
  return options;
}

// A normal pile follows selection order. Runs are always ascending, largest on top.
export function selectionPlan(ids, kind = '') {
  const options = Array.isArray(ids) ? meldOptions(ids) : [];
  const invalid = reason => ({ valid: false, cards: Array.isArray(ids) ? [...ids] : [], top: '', kind: '', options, reason });
  if (!ids?.length) return invalid('请先选择要打出的牌。');
  if (!options.length) return invalid(ids.includes('halo') ? '光环只能单独打出。' : '组合不合法：请选择同花色、同数字或至少两张连续数字。');
  const option = kind ? options.find(o => o.kind === kind) : options.find(o => o.kind === '顺子') || options[0];
  if (!option) return invalid('当前选牌不符合所选的组合方式。');
  const ordered = option.kind === '顺子' ? [...ids].sort((a, b) => card(a).value - card(b).value) : [...ids];
  return { valid: true, cards: ordered, top: ordered.at(-1), kind: option.kind, options, reason: '' };
}
