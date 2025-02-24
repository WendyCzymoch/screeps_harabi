// Call this function at the end of your main loop

const { config } = require('./config')

Overlord.exportStats = function () {
  // Reset stats object
  Memory.stats = Memory.stats || {}
  Memory.stats.gcl = {}
  Memory.stats.rooms = {}
  Memory.stats.gpl = {}
  Memory.stats.cpu = Memory.stats.cpu || {}
  Memory.stats.heap = {}

  Memory.stats.time = Game.time

  // Collect room stats
  const resources = {}

  for (const room of Overlord.myRooms) {
    let roomStats = (Memory.stats.rooms[room.name] = {})
    roomStats.storageEnergy = room.storage ? room.storage.store.energy : 0
    roomStats.terminalEnergy = room.terminal ? room.terminal.store.energy : 0
    roomStats.terminalUsed = room.terminal ? room.terminal.store.getUsedCapacity() : 0
    roomStats.energyAvailable = room.energyAvailable
    roomStats.energyCapacityAvailable = room.energyCapacityAvailable
    roomStats.controllerProgress = room.controller.progress
    roomStats.controllerProgressTotal = room.controller.progressTotal
    roomStats.controllerLevel = room.controller.level
    if (room.terminal) {
      for (const resourceType in room.terminal.store) {
        if (resourceType === RESOURCE_ENERGY) {
          continue
        }
        resources[resourceType] = resources[resourceType] || 0
        resources[resourceType] += room.terminal.store[resourceType]
      }
    }
  }

  if (config.shards) {
    const localMemory = JSON.parse(InterShardMemory.getLocal() || '{}')
    localMemory.numRooms = Object.keys(Memory.stats.rooms).length
    InterShardMemory.setLocal(JSON.stringify(localMemory))
  }

  Memory.stats.resources = resources

  // Collect GCL stats
  Memory.stats.gcl.progress = Game.gcl.progress
  Memory.stats.gcl.progressTotal = Game.gcl.progressTotal
  Memory.stats.gcl.level = Game.gcl.level

  // Collect GPL stats
  Memory.stats.gpl.progress = Game.gpl.progress
  Memory.stats.gpl.progressTotal = Game.gpl.progressTotal
  Memory.stats.gpl.level = Game.gpl.level

  // Collect credit stats
  Memory.stats.credit = Game.market.credits

  // Collect Heap stats
  const heapStatistics = Game.cpu.getHeapStatistics()
  const heaSize = heapStatistics.total_heap_size + heapStatistics.externally_allocated_size
  Memory.stats.heap.used = heaSize / heapStatistics.heap_size_limit

  // Collect CPU stats
  Memory.stats.cpu.bucket = Game.cpu.bucket
  Memory.stats.cpu.limit = Game.cpu.limit
  Memory.stats.cpu.used = Game.cpu.getUsed() + (Memory.stats.cpu.serializeCpu || 0)

  if (!Memory.stats.cpu.serializeCpu || Game.time > (Memory.stats.cpu.serializeCpuTime || 0) + CREEP_LIFE_TIME) {
    const before = Game.cpu.getUsed()

    JSON.stringify(Memory)

    const serializeCpu = Game.cpu.getUsed() - before

    if (Memory.stats.cpu.serializeCpu) {
      Memory.stats.cpu.serializeCpu = Memory.stats.cpu.serializeCpu * 0.9 + serializeCpu * 0.1
    } else {
      Memory.stats.cpu.serializeCpu = serializeCpu
    }

    Memory.stats.cpu.serializeCpuTime = Game.time
  }
}
