const { Util } = require('./util')

const array = []

for (let i = 0; i < 10; i++) {
  array.push({ power: Math.random() })
}

console.log(JSON.stringify(array))

console.log(Util.getMinObject(array, (element) => element.power))

for (const creep of Object.values(Game.creeps)) {
  if (!creep.memory.role) {
    creep.suicide()
  }
}
