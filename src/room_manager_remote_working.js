Room.prototype.manageRemote = function () {

}

Room.prototype.getRemoteStatus = function (targetRoomName) {
    this.memory.remotes = this.memory.remotes || {}
    this.memory.remotes[targetRoomName] = this.memory.remotes[targetRoomName] || {}
    return this.memory.remotes[targetRoomName]
}

Room.prototype.getRemoteValue = function (targetRoomName) {
    const remoteStatus = this.getRemoteStatus(targetRoomName)
    const canReserve = this.energyCapacityAvailable >= 650

    if (remoteStatus && remoteStatus.remoteValue && (!!remoteStatus.canReserve === canReserve)) {
        return remoteStatus.remoteValue
    }

    let result = 0

    const blueprint = getRemoteBlueprint(room, targetRoomName)

    if (!blueprint) {
        console.log(`${room.name} cannot get blueprint of ${targetRoomName}`)
        return 0
    }

    for (const info of blueprint) {
        const income = canReserve ? 10 : 5
        const distance = info.pathLength

        const minerCost = (950 / (1500 - distance))
        const haluerCost = (distance * HAULER_RATIO * (canReserve ? 75 : 100) + 100) / 1500
        const creepCost = (minerCost + haluerCost) * (canReserve ? 1 : 0.5)

        const containerCost = canReserve ? 0.5 : 0
        const roadCost = canReserve ? (1.6 * distance + 10 * distance / (1500 - distance) + 1.5 * distance / (600 - distance)) * 0.001 : 0

        const totalCost = creepCost + containerCost + roadCost

        const netIncome = income - totalCost

        result += netIncome

        if (oneSource) {
            break
        }
    }

    if (remoteInfo) {
        remoteInfo.canReserve = canReserve
        remoteInfo.oneSource = oneSource
        remoteInfo.remoteValueTime = Game.time
        remoteInfo.remoteValue = result
    }

    return result
}

Room.prototype.getRemoteBlueprint = function (targetRoomName) {
    const remoteStatus = this.getRemoteStatus(targetRoomName)
    if (remoteStatus && remoteStatus.blueprint) {
        return remoteStatus.blueprint
    }

    const startingPoint = this.getStoragePos()
    if (!startingPoint) {
        return
    }

    const targetRoom = Game.rooms[targetRoomName]
    if (!targetRoom) {
        return
    }

    const result = []

    const sources = targetRoom.find(FIND_SOURCES)
    const roadPositions = [...getAllRemoteRoadPositions(room)]
    const basePlan = room.basePlan

    const remoteNames = room.getRemoteNames()

    const intermediates = new Set()

    for (const source of sources) {
        const search = PathFinder.search(source.pos, { pos: startingPoint.pos, range: 1 }, {
            plainCost: 5,
            swampCost: 6, // swampCost higher since road is more expensive on swamp
            maxOps: 20000,
            heuristicWeight: 1,
            roomCallback: function (roomName) {
                if (![roomNameInCharge, targetRoomName, ...remoteNames].includes(roomName)) {
                    return false
                }

                const costs = new PathFinder.CostMatrix;

                for (const pos of roadPositions) {
                    if (pos.roomName === roomName) {
                        costs.set(pos.x, pos.y, 4)
                    }
                }

                const currentRoom = Game.rooms[roomName];
                if (!currentRoom) {
                    return costs;
                }

                currentRoom.find(FIND_STRUCTURES).forEach(function (structure) {
                    if (structure.structureType === STRUCTURE_ROAD) {
                        costs.set(structure.pos.x, structure.pos.y, 3)
                        return
                    }

                    if (structure.structureType === STRUCTURE_CONTAINER) {
                        costs.set(structure.pos.x, structure.pos.y, 50)
                        return
                    }

                    if (OBSTACLE_OBJECT_TYPES.includes(structure.structureType)) {
                        costs.set(structure.pos.x, structure.pos.y, 255)
                        return
                    }

                })

                for (const sourceInner of currentRoom.sources) {
                    if (source.id === sourceInner.id) {
                        continue
                    }
                    for (const pos of sourceInner.pos.getInRange(1)) {
                        if (!pos.isWall && costs.get(pos.x, pos.y) < 50) {
                            costs.set(pos.x, pos.y, 50)
                        }
                    }
                }

                if (roomName === roomNameInCharge && basePlan) {
                    for (let i = 1; i <= 8; i++) {
                        for (const structure of basePlan[`lv${i}`]) {
                            if (structure.structureType === STRUCTURE_ROAD) {
                                costs.set(structure.pos.x, structure.pos.y, 2)
                                continue
                            }

                            if (OBSTACLE_OBJECT_TYPES.includes(structure.structureType)) {
                                costs.set(structure.pos.x, structure.pos.y, 255)
                            }
                        }
                    }
                }

                return costs;
            }
        })

        if (search.incomplete) {
            console.log(`${room.name} cannot find path to ${targetRoomName}`)
            continue
        }

        const path = search.path
        const pathLength = path.length

        if (pathLength > MAX_DISTANCE) {
            console.log(`${room.name} is too far to ${targetRoomName}`)
            continue
        }

        visualizePath(path)

        roadPositions.push(...path)

        const info = {}

        info.sourceId = source.id

        info.available = source.available

        info.pathLength = pathLength

        info.maxCarry = Math.ceil(path.length * HAULER_RATIO * 0.95 + 0.5)

        const structures = []

        const containerPos = path.shift()

        structures.push(containerPos.packInfraPos('container'))

        for (const pos of path) {
            const roomName = pos.roomName
            if (![roomNameInCharge, targetRoomName].includes(roomName)) {
                intermediates.add(roomName)
            }
            structures.push(pos.packInfraPos('road'))
        }

        info.structures = structures

        result.push(info)
    }

    if (result.length === 0) {
        return
    }

    result.sort((a, b) => a.pathLength - b.pathLength)

    if (remoteInfo) {
        if (intermediates.size > 0) {
            remoteInfo.intermediates = Array.from(intermediates)
        }

        remoteInfo.blueprint = result
        remoteInfo.controllerAvailable = targetRoom.controller.pos.available
    }


    return result
}

Room.prototype.getStoragePos = function () {
    const basePlan = this.basePlan
    const lv4 = basePlan['lv4']
    const storagePlan = lv4.find(plan => plan.structureType === STRUCTURE_STORAGE)
    if (storagePlan) {
        return storagePlan.pos
    }
}