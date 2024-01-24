const MinHeap = require("./util_min_heap")

Room.prototype.getChunks = function () {
  data.info = false

  const distanceTransform = this.getDistanceTransform(false)
  const DTcosts = distanceTransform.costs
  const DTPositions = distanceTransform.positions
  const levels = Object.keys(DTPositions).map(level => Number(level)).sort((a, b) => b - a)

  const minHeap = new MinHeap((pos) => -DTcosts.get(pos.x, pos.y))

  const costsForLabel = new PathFinder.CostMatrix
  const costsForCheck = new PathFinder.CostMatrix
  const costsForCheckWatershed = new PathFinder.CostMatrix

  let label = 1

  for (const exitPos of this.find(FIND_EXIT)) {

    costsForLabel.set(exitPos.x, exitPos.y, 1)
    costsForCheck.set(exitPos.x, exitPos.y, 1)
  }

  for (const exitPos of this.find(FIND_EXIT)) {
    for (const pos of exitPos.getAtRange(1)) {
      if (pos.isWall) {
        continue
      }
      if (costsForLabel.get(pos.x, pos.y) > 0) {
        continue
      }
      if (costsForCheckWatershed.get(pos.x, pos.y) > 0) {
        continue
      }
      minHeap.insert(pos)
      costsForCheckWatershed.set(pos.x, pos.y, 1)
      costsForLabel.set(pos.x, pos.y, 1)
    }
  }


  // get regions of local maxima
  outer:
  for (const level of levels) {
    for (const pos of DTPositions[level]) {
      if (costsForCheck.get(pos.x, pos.y) > 0) {
        continue
      }

      let isLocalMaxima = true
      const region = []

      const costsForBFS = new PathFinder.CostMatrix

      region.push(pos)
      const queue = [pos]

      while (queue.length > 0) {
        const currentPos = queue.shift()
        costsForCheck.set(currentPos.x, currentPos.y, 1)
        for (const adjacentPos of currentPos.getAtRange(1)) {
          if (costsForBFS.get(adjacentPos.x, adjacentPos.y) > 0) {
            continue
          }

          costsForBFS.set(adjacentPos.x, adjacentPos.y, 1)

          const adjacentLevel = DTcosts.get(adjacentPos.x, adjacentPos.y)

          if (adjacentLevel < level) {
            continue
          }

          if (adjacentLevel > level) {
            isLocalMaxima = false
            break
          }

          region.push(adjacentPos)
          queue.push(adjacentPos)

        }
      }

      if (isLocalMaxima) {
        label++
        costsForLabel.set(pos.x, pos.y, label)
        for (const adjacentPos of pos.getAtRange(1)) {
          minHeap.insert(adjacentPos)
          costsForCheckWatershed.set(adjacentPos.x, adjacentPos.y, 1)
        }
      }
    }
  }

  //watershed
  const watershed = []
  console.log(minHeap.getSize())

  while (minHeap.getSize() > 0) {
    const current = minHeap.remove()

    const labels = new Set()

    for (const adjacent of current.getAtRange(1)) {
      if (adjacent.isWall) {
        continue
      }
      const label = costsForLabel.get(adjacent.x, adjacent.y)
      if (label === 255) {
        continue
      }
      if (label === 0) {
        if (costsForCheckWatershed.get(adjacent.x, adjacent.y) === 0) {
          minHeap.insert(adjacent)
          costsForCheckWatershed.set(adjacent.x, adjacent.y, 1)
        }
        continue
      }
      labels.add(label)
    }

    if (labels.size > 1) {
      costsForLabel.set(current.x, current.y, 255)
      watershed.push(current)
    } else if (labels.size === 1) {
      labels.forEach(value => {
        costsForLabel.set(current.x, current.y, value)
      })
    }
  }

  console.log(`watershed : ${watershed.length}`)

  for (const pos of watershed) {
    this.visual.circle(pos, { fill: COLOR_NEON_RED })
  }

  const result = {}

  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      const label = costsForLabel.get(x, y)
      if (label === 0 || label === 255) {
        continue
      }
      result[label] = result[label] || []
      result[label].push(new RoomPosition(x, y, this.name))
      // this.visual.text(label, x, y)
    }
  }

  return { positions: result, watershed: watershed, costs: costsForLabel }
}