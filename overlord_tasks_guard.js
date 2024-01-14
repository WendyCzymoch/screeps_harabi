Overlord.manageGuardTasks = function () {
    const tasks = Object.values(this.getTasksWithCategory('guard'))

    for (const request of tasks) {
        const roomInCharge = Game.rooms[request.roomNameInCharge]

        if (request.completed === true) {
            this.deleteTask(request)
            continue
        }

        if (!roomInCharge) {
            this.deleteTask(request)
            continue
        }

        Game.map.visual.text('guard', new RoomPosition(25, 25, request.roomName), { color: COLOR_NEON_GREEN })
        roomInCharge.guardRoom(request)
    }
}

const GuardRequest = function (room, targetRoomName, enemyInfo) {
    this.category = 'guard'
    this.id = targetRoomName
    this.time = Game.time
    this.status = 'prepare'

    this.roomName = targetRoomName
    this.roomNameInCharge = room.name

    this.enemyInfo = enemyInfo
}

Room.prototype.guardRoom = function (request) {
    const roomName = request.roomName
    const guards = this.getGuards(roomName)

    if (this.memory.militaryThreat) {
        request.completed = true
        request.result = 'threat'
        for (const guard of guards) {
            guard.memory.targetRoomName = undefined
        }
        return
    }

    if (Game.time > request.time + 1000) {
        request.result = 'expire'
        request.completed = true
        for (const guard of guards) {
            guard.memory.targetRoomName = undefined
        }
        return
    }

    const targetRoom = Game.rooms[roomName]

    request.numGuards = guards.length

    if (targetRoom) {
        const hostileCreeps = targetRoom.findHostileCreeps()
        const enemyInfo = getCombatInfo(hostileCreeps)
        request.enemyInfo = enemyInfo
        request.isEnemy = hostileCreeps.length > 0
    } else if (request.enemyInfo && (Game.time > (request.enemyInfo.time || 0) + 100)) {
        request.enemyInfo = new CombatInfo()
    }

    const enemyInfo = request.enemyInfo

    if (!request.cleared && request.isEnemy === false) {
        request.cleared = true
        request.clearedTick = Game.time
    } else if (request.cleared && request.isEnemy) {
        request.cleared = false
    }

    if (request.cleared && (Game.time > request.clearedTick + 10)) {
        request.result = 'cleared'
        request.completed = true
        for (const guard of guards) {
            guard.memory.targetRoomName = undefined
        }
        return
    }

    if (request.cleared) {
        request.status = 'cleared'
        doCleanUp(guards)
        return
    }

    request.gathered = this.gatherGuards(roomName, enemyInfo)

    if (request.gathered && request.rallied) {
        request.status = 'combat'
        doCombat(guards, roomName)
        return
    } else {
        request.rallied = false
    }

    request.status = 'gather'

    request.rallied = this.rallyGuards(guards)


}

function doCleanUp(guards) {
    for (const guard of guards) {
        guard.healWounded()
    }
}

function doCombat(guards, roomName) {
    for (const guard of guards) {
        if (guard.room.name !== roomName) {
            guard.activeHeal()
            guard.harasserRangedAttack()
            guard.moveToRoom(roomName, 2)
            continue
        }
        if (isEdgeCoord(guard.pos.x, guard.pos.y)) {
            guard.activeHeal()
            guard.harasserRangedAttack()
            guard.moveToRoom(roomName, 2)
            continue
        }
        const tagets = guard.room.findHostileCreeps()
        if (tagets.length > 0) {
            guard.handleCombatants(tagets)
            continue
        }

    }
}

Room.prototype.rallyGuards = function (guards) {
    let result = true
    const captain = guards[0]
    for (const guard of guards) {
        if (guard.spawning) {
            result = false
            continue
        }
        guard.activeHeal()
        if (guard.room.name !== this.name || isEdgeCoord(guard.pos.x, guard.pos.y)) {
            guard.moveToRoom(this.name, 2)
            result = false
            continue
        }
        if (guard.pos.getRangeTo(captain) > 2) {
            guard.setWorkingInfo(captain.pos, 2)
            guard.moveMy({ pos: captain.pos, range: 1 })
            result = false
        }
    }
    return result
}

Room.prototype.getGuards = function (roomName) {
    const guards = Overlord.getCreepsByRole(this.name, 'guard')
    return guards.filter(creep => creep.memory.targetRoomName === roomName)
}

Room.prototype.getEnemyInfo = function () {
    if (this.enemyInfo) {
        return this.enemyInfo
    }
    const hostileCreeps = this.findHostileCreeps()
    return this.enemyInfo = getCombatInfo(hostileCreeps)
}

Room.prototype.gatherGuards = function (roomName, enemyInfo) {
    const gaurdsGathered = this.getGuards(roomName)
    if (gaurdsGathered.some(creep => creep.spawning)) {
        return false
    }

    const combatInfo = getCombatInfo(gaurdsGathered)

    while (enemyInfo && !combatInfo.canWinWithKiting(enemyInfo)) {
        const moveFirst = enemyInfo.attack === enemyInfo.rangedAttack
        const idlingGuard = this.getIdlingGuards()[0]
        if (idlingGuard) {
            gaurdsGathered.push(idlingGuard)
            idlingGuard.memory.targetRoomName = roomName
            combatInfo.add(idlingGuard.getCombatInfo())
            continue
        }
        this.requestGuard(roomName, moveFirst)
        return false
    }

    return true
}

Room.prototype.getIdlingGuards = function () {
    const guards = Overlord.getCreepsByRole(this.name, 'guard')
    return guards.filter(creep => !creep.memory.targetRoomName && !creep.memory.harass)
}

Room.prototype.requestGuard = function (targetRoomName, moveFirst = false) {
    if (!this.hasAvailableSpawn()) {
        return
    }

    let body = undefined

    costMax = this.energyCapacityAvailable

    const costs = Object.keys(harasserBody).sort((a, b) => b - a)
    for (const bodyCost of costs) {
        if (bodyCost <= costMax) {
            cost = bodyCost
            body = moveFirst ? harasserBodyMoveFirst[bodyCost] : harasserBody[bodyCost]
            break
        }
    }

    if (!body) {
        return
    }

    const name = `${this.name} guard ${Game.time}_${this.spawnQueue.length}`
    const memory = {
        role: 'guard',
        base: this.name,
        targetRoomName
    }

    const request = new RequestSpawn(body, name, memory, { priority: SPAWN_PRIORITY['guard'] })
    this.spawnQueue.push(request)
}

function getCombatInfo(array) {
    let attackTotal = 0
    let rangedAttackTotal = 0
    let healTotal = 0
    let hitsTotal = 0
    for (const creep of array) {
        const attack = creep.attackPower
        const heal = creep.healPower
        if (attack + heal === 0) {
            continue
        }
        attackTotal += attack
        rangedAttackTotal += creep.rangedAttackPower
        healTotal += heal
        hitsTotal += creep.hits
    }
    return new CombatInfo(attackTotal, rangedAttackTotal, healTotal, hitsTotal)
}

Creep.prototype.getCombatInfo = function () {
    const attack = this.attackPower
    const rangedAttack = this.rangedAttackPower
    const heal = this.healPower
    const hits = this.hits

    return new CombatInfo(attack, rangedAttack, heal, hits)
}

class CombatInfo {
    constructor(attack, rangedAttack, heal, hits) {
        this.time = Game.time
        this.attack = attack || 0
        this.rangedAttack = rangedAttack || 0
        this.heal = heal || 0
        this.hits = hits || 0
        this.strength = attack + heal
    }

    canWinWithKiting(combatInfo) {
        return canWin(this.rangedAttack, this.heal, this.hits, combatInfo.rangedAttack, combatInfo.heal, combatInfo.hits)
    }

    canWin(combatInfo) {
        return canWin(this.attack, this.heal, this.hits, combatInfo.attack, combatInfo.heal, combatInfo.hits)
    }

    add(combatInfo) {
        this.attack += combatInfo.attack
        this.rangedAttack += combatInfo.rangedAttack
        this.heal += combatInfo.heal
        this.hits += combatInfo.hits
    }
}

function canWin(attack1, heal1, hits1, attack2, heal2, hits2) {
    const myAttack = Math.max(0, attack1 - heal2)
    const enemyAttack = Math.max(0, attack2 - heal1)
    if (myAttack === 0) {
        return false
    }
    if (enemyAttack === 0) {
        return true
    }
    return (hits1 / enemyAttack) > (hits2 / myAttack)
}

module.exports = {
    getCombatInfo,
    GuardRequest,
    CombatInfo
}