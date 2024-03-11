const { RoomPostionUtils } = require('./util_roomPosition')

global.TRAFFIC_TEST = false

Room.prototype.manageTraffic = function () {
  const creeps = this.find(FIND_MY_CREEPS)

  const dist = {}
  const match = new Map()

  const movingCreeps = []

  // check creeps to solve. match creeps to current pos
  for (const creep of creeps) {
    creep.matchedPos = creep.pos

    const packedCoord = RoomPostionUtils.packCoord(creep.pos)

    match.set(packedCoord, creep)
  }

  while (bfs(creeps, dist, match)) {
    for (const creep of movingCreeps) {
      if (!creep.matchedPos) {
        dfs(creep, dist, match)
      }
    }
  }

  for (const creep of creeps) {
    const matchedPos = creep.matchedPos
    if (matchedPos && !creep.pos.isEqualTo(matchedPos)) {
      creep.move(creep.pos.getDirectionTo(matchedPos))
    }
  }
}

function bfs(creeps, dist, match) {
  const queue = []
  for (const creep of creeps) {
    if (!creep.matchedPos) {
      dist[creep.name] = 0
      queue.push(creep)
    } else {
      dist[creep.name] = 100
    }
  }

  dist[undefined] = 100

  while (queue.length) {
    const creep = queue.shift()

    const name = creep ? creep.name : undefined

    if (dist[name] < dist[undefined]) {
      for (const pos of creep.getMoveIntent()) {
        const packedCoord = RoomPostionUtils.packCoord(pos)

        const pairedCreep = match[packedCoord]

        const name = pairedCreep ? pairedCreep.name : undefined

        if (dist[name] === 100) {
          dist[name] = dist[creep.name] + 1
          queue.push(pairedCreep)
        }
      }
    }
  }
  return dist[undefined] !== 100
}

function dfs(creep, dist, match) {
  if (creep !== undefined) {
    for (const pos of creep.getMoveIntent()) {
      const packedCoord = RoomPostionUtils.packCoord(pos)
      const pairedCreep = match[packedCoord]
      const name = pairedCreep ? pairedCreep.name : undefined
      if (dist[name] === dist[creep.name] + 1) {
        if (dfs(pairedCreep, dist, match)) {
          creep.matchedPos = pos
          match[packedCoord] = creep
          return true
        }
      }
    }
    dist[creep.name] = 100
    return false
  }
  return true
}

Creep.prototype.getStuckTick = function () {
  return this.heap.stuck || 0
}

/**
 *
 * @param {number} a - index of a creep in array of creeps
 * @param {array} creeps - array of creeps
 * @param {array} visited - array which represent if a creep is checked
 * @param {array} costs - costMatrix which represent index of the creep which is occupying that position
 */
Room.prototype.dfs = function (creep, creeps, visited) {}

Creep.prototype.setNextPos = function (pos) {
  this._nextPos = pos
}

Creep.prototype.getNextPos = function () {
  return this._nextPos
}

Creep.prototype.setWorkingInfo = function (pos, range) {
  this._workingInfo = { pos, range }
}

Creep.prototype.getWorkingInfo = function () {
  return this._workingInfo
}

Creep.prototype.getMoveIntent = function () {
  if (this._moveIntent !== undefined) {
    return this._moveIntent
  }

  const result = []

  if (this.fatigue > 0) {
    return result
  }

  const nextPos = this.getNextPos()
  if (nextPos) {
    result.push(nextPos)
    return (this._moveIntent = result)
  }

  result.push(this.pos)

  const adjacents = this.pos.getAtRange(1).sort((a, b) => Math.random() - 0.5)

  const workingInfo = this.getWorkingInfo()

  if (workingInfo) {
    const targetPos = workingInfo.pos
    const range = workingInfo.range
    const positionsOutOfRange = []

    for (const pos of adjacents) {
      if (!pos.walkable) {
        continue
      }

      if (pos.getRangeTo(targetPos) > range) {
        positionsOutOfRange.push(pos)
        continue
      }

      result.push(pos)
    }
    result.push(...positionsOutOfRange)

    return (this._moveIntent = result)
  }

  for (const pos of adjacents) {
    if (!pos.walkable) {
      continue
    }
    result.push(pos)
  }

  return (this._moveIntent = result)
}
