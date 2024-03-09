const IntentProfiler = {
  init() {
    for (const prototype of this.prototypes) {
      const object = prototype.object
      const functionNames = prototype.functionNames

      for (const functionName of functionNames) {
        this.intentWrap(object, functionName)
      }
    }

    global.printIntent = this.print
  },

  print() {
    if (!Game.intentProfile) {
      return
    }

    const padLength = 20

    console.log(`------------------------`)
    console.log(`time:${Game.time}`)
    console.log(`${'function'.padEnd(padLength)}${'num'.padEnd(padLength)}${'time'.padEnd(padLength)}`)

    const keys = Object.keys(Game.intentProfile).sort((a, b) => Game.intentProfile[b] - Game.intentProfile[a])

    for (const key of keys) {
      const value = Game.intentProfile[key]
      console.log(
        `${key.padEnd(padLength)}${String(value).padEnd(padLength)}${(value * 0.2).toFixed(2).padEnd(padLength)}`
      )
    }
  },

  intentWrap(object, functionName) {
    const objectToWrap = object.prototype || object

    const originalFunctionName = `_${functionName}`

    objectToWrap[originalFunctionName] = objectToWrap[functionName]

    objectToWrap[functionName] = function () {
      const returnValue = this[originalFunctionName].apply(this, arguments)
      if (returnValue === OK) {
        Game.intentProfile = Game.intentProfile || {}

        Game.intentProfile.total = Game.intentProfile.total || 0
        Game.intentProfile.total++

        Game.intentProfile[functionName] = Game.intentProfile[functionName] || 0
        Game.intentProfile[functionName]++
      }

      return returnValue
    }
  },

  prototypes: [
    {
      object: Creep,
      functionNames: [
        'attack',
        'attackController',
        'build',
        'claimController',
        'dismantle',
        'drop',
        'generateSafeMode',
        'harvest',
        'heal',
        'move',
        'notifyWhenAttacked',
        'pickup',
        'pull',
        'rangedAttack',
        'rangedHeal',
        'rangedMassAttack',
        'repair',
        'reserveController',
        'signController',
        'suicide',
        'transfer',
        'upgradeController',
        'withdraw',
      ],
    },
    { object: Structure, functionNames: ['notifyWhenAttacked'] },
    {
      object: StructureLab,
      functionNames: ['boostCreep', 'reverseReaction', 'runReaction', 'unboostCreep'],
    },
    {
      object: StructureSpawn,
      functionNames: ['spawnCreep', 'recycleCreep', 'renewCreep'],
    },
    {
      object: StructureFactory,
      functionNames: ['produce'],
    },
    {
      object: StructureTerminal,
      functionNames: ['send'],
    },
  ],
}

module.exports = {
  IntentProfiler,
}
