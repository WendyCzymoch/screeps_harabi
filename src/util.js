const MinHeap = require('./util_min_heap')

Math.clamp = function (value, min, max) {
  return Math.min(Math.max(value, min), max)
}

Number.prototype.toFixedNumber = function (digit) {
  const pow = Math.pow(10, digit)
  return Math.round(this * pow) / pow
}

class Util {
  static getMaxObject(array, callback) {
    if (!array.length) {
      return undefined
    }
    let maximumPoint = array[0]
    let maximumValue = callback(maximumPoint)
    for (const point of array) {
      const value = callback(point)
      if (value > maximumValue) {
        maximumPoint = point
        maximumValue = value
      }
    }
    return maximumPoint
  }

  static getMaxObjects(array, callback, number = 1) {
    const heap = new MinHeap(callback)
    let criteria = -Infinity
    for (const element of array) {
      if (heap.getSize() < number || callback(element) > criteria) {
        if (heap.getSize() >= number) {
          heap.remove()
        }
        heap.insert(element)
        criteria = callback(heap.getMin())
      }
    }
    return heap.toArray()
  }
  static getMinObject(array, callback) {
    const newCallback = (element) => -1 * callback(element)
    return this.getMaxObject(array, newCallback)
  }

  static getMinObjects(array, callback, number = 1) {
    const newCallback = (element) => -1 * callback(element)
    return this.getMaxObjects(array, newCallback, number)
  }
}

function getRoomMemory(roomName) {
  Memory.rooms[roomName] = Memory.rooms[roomName] || {}
  return Memory.rooms[roomName]
}

module.exports = {
  getRoomMemory,
  Util,
}
