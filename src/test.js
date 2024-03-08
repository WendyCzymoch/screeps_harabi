Memory = {}

Memory.creeps = {}

class Creep {
  constructor(name) {
    this.name = name
  }
}

Object.defineProperties(Creep.prototype, {
  mem: {
    get() {
      Memory.creeps[this.name] = Memory.creeps[this.name] || {}
      return Memory.creeps[this.name]
    },
    set(object) {
      Memory.creeps[this.name] = object
    },
  },
})

const myCreep = new Creep('meh')

console.log(myCreep.name)

console.log(myCreep.mem)

myCreep.mem.role = 'sheep'

console.log(myCreep.mem.role)

myCreep.mem = { role: 'sheep' }

console.log(myCreep.mem.role)
