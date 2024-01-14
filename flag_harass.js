Flag.prototype.harass = function (number = 2) {
    const roomName = this.pos.roomName
    const closestMyRoom = this.memory.base ? Game.rooms[this.memory.base] : Overlord.findClosestMyRoom(this.pos.roomName, 7)
    if (closestMyRoom && !this.memory.base) {
        this.memory.base = closestMyRoom.name
    }

    if (!closestMyRoom) {
        this.remove()
        return
    }
    const defenders = Overlord.getCreepsByRole(roomName, 'colonyDefender')
    const activeDefenders = defenders.filter(creep => creep.spawning || (creep.ticksToLive > 500))

    new RoomVisual(roomName).text(`${activeDefenders.length}/${number}`, this.pos.x, this.pos.y - 1, { color: COLOR_NEON_RED })
    if (activeDefenders.length < number && (this.memory.next || 0) < Game.time) {
        closestMyRoom.requestColonyDefender(roomName, { doCost: false })
        return
    } else {
        for (const activeDefender of activeDefenders) {
            if ((this.memory.next || 0) < (Game.time + activeDefender.ticksToLive)) {
                this.memory.next = Game.time + activeDefender.ticksToLive
            }
        }
    }
}

Flag.prototype.defend = function () {
    const roomName = this.pos.roomName
    const closestMyRoom = this.findClosestMyRoom(6)
    if (!closestMyRoom) {
        this.remove()
        return
    }

    const room = Game.rooms[roomName]
}