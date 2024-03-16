class CreepUtil {
  static getMinerModel(energyCapacity, maxWork) {
    let cost = 0
    let work = 0
    let move = 0
    let carry = 0

    move += 1
    cost += BODYPART_COST[MOVE]

    while (cost < energyCapacity && work + move + carry < MAX_CREEP_SIZE) {
      if (work < 5 && work < maxWork && energyCapacity >= cost + BODYPART_COST[WORK]) {
        work++
        cost += BODYPART_COST[WORK]
        continue
      }

      if ((move === 0 || work / move > 2) && energyCapacity >= cost + BODYPART_COST[MOVE]) {
        move++
        cost += BODYPART_COST[MOVE]
        continue
      }

      if (carry < 1 && energyCapacity >= cost + BODYPART_COST[CARRY]) {
        carry++
        cost += BODYPART_COST[CARRY]
        continue
      }

      if (maxWork && work >= maxWork) {
        break
      }

      if (energyCapacity >= cost + BODYPART_COST[WORK]) {
        work++
        cost += BODYPART_COST[WORK]
        continue
      }

      break
    }
    const body = parseBody(`${work - 1}w${carry}c${move}m1w`)

    return { body, numWork: work, cost }
  }
}

module.exports = {
  CreepUtil,
}
