const ts  = () => new Date().toISOString()
const fmt = (lvl, args) => `[${ts()}] [${lvl.padEnd(4)}] ${args.join(' ')}`

export const log  = (...a) => console.log(fmt('INFO', a))
export const warn = (...a) => console.warn(fmt('WARN', a))
export const err  = (...a) => console.error(fmt('ERR', a))
