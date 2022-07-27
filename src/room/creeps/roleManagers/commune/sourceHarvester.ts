import { getRange, unpackAsPos } from 'international/generalFunctions'
import { SourceHarvester } from '../../creepClasses'

export function sourceHarvesterManager(room: Room, creepsOfRole: string[]) {
     // Loop through the names of the creeps of the role

     for (const creepName of creepsOfRole) {
          // Get the creep using its name

          const creep: SourceHarvester = Game.creeps[creepName]

          // Define the creep's designated source

          const sourceIndex = creep.memory.SI

          // Try to find a harvestPosition, inform false if it failed

          if (!creep.findSourcePos(sourceIndex)) return false

          // Try to move to source. If creep moved then iterate

          if (creep.travelToSource()) continue

          // Try to harvest the designated source

          creep.advancedHarvestSource(room.sources[sourceIndex])

          // Try to transfer to source extensions, iterating if success

          if (creep.transferToSourceExtensions()) continue

          // Try to transfer to the source link, iterating if success

          if (creep.transferToSourceLink()) continue

          // Try to repair the sourceContainer

          creep.repairSourceContainer(room.sourceContainers[sourceIndex])
     }
}

SourceHarvester.prototype.isDying = function () {
     // Inform as dying if creep is already recorded as dying

     if (this.memory.dying) return true

     // Stop if creep is spawning

     if (!this.ticksToLive) return false

     // If the creep's remaining ticks are more than the estimated spawn time plus travel time, inform false

     if (
          this.ticksToLive >
          this.body.length * CREEP_SPAWN_TIME + (this.room.sourcePaths[this.memory.SI].length - 3)
     )
          return false

     // Record creep as dying

     this.memory.dying = true
     return true
}

SourceHarvester.prototype.travelToSource = function () {

     const { room } = this

     this.say('🚬')

     // Unpack the harvestPos

     const harvestPos = unpackAsPos(this.memory.packedPos)

     // If the creep is at the creep's packedHarvestPos, inform false

     if (getRange(this.pos.x, harvestPos.x, this.pos.y, harvestPos.y) === 0) return false

     // If the creep's movement type is pull

     if (this.memory.getPulled) return true

     // Otherwise say the intention and create a moveRequest to the creep's harvestPos, and inform the attempt

     this.say(`⏩${this.memory.SI}`)

     this.createMoveRequest({
          origin: this.pos,
          goal: {
               pos: new RoomPosition(harvestPos.x, harvestPos.y, room.name),
               range: 0,
          },
          avoidEnemyRanges: true,
     })

     return true
}

SourceHarvester.prototype.transferToSourceExtensions = function () {

     const { room } = this

     // If all spawningStructures are filled, inform false

     if (room.energyAvailable === room.energyCapacityAvailable) return false

     // If the creep is not nearly full, inform false

     if (this.store.getFreeCapacity(RESOURCE_ENERGY) > this.parts.work * HARVEST_POWER) return false

     // Get adjacent structures to the creep

     const adjacentStructures = room.lookForAtArea(
          LOOK_STRUCTURES,
          this.pos.y - 1,
          this.pos.x - 1,
          this.pos.y + 1,
          this.pos.x + 1,
          true,
     )

     // For each structure of adjacentStructures

     for (const adjacentPosData of adjacentStructures) {
          // Get the structure at the adjacentPos

          const structure = adjacentPosData.structure as AnyStoreStructure

          // If the structure has no store property, iterate

          if (!structure.store) continue

          // If the structureType is an extension, iterate

          if (structure.structureType !== STRUCTURE_EXTENSION) continue

          // Otherwise, if the structure is full, iterate

          if (structure.store.getFreeCapacity(RESOURCE_ENERGY) === 0) continue

          // Otherwise, transfer to the structure and inform true

          this.transfer(structure, RESOURCE_ENERGY)
          return true
     }

     // Inform false

     return false
}

SourceHarvester.prototype.transferToSourceLink = function () {

     const { room } = this

     // If the creep is not nearly full, stop

     if (this.store.getFreeCapacity(RESOURCE_ENERGY) > this.parts.work * HARVEST_POWER) return false

     // Find the sourceLink for the creep's source, Inform false if the link doesn't exist

     const sourceLink = room.sourceLinks[this.memory.SI]
     if (!sourceLink) return false

     // Try to transfer to the sourceLink and inform true

     return this.advancedTransfer(sourceLink)
}

SourceHarvester.prototype.repairSourceContainer = function (sourceContainer) {

     // If there is no container, inform false

     if (!sourceContainer) return false

     // Get the creep's number of work parts

     const workPartCount = this.parts.work

     // If the sourceContainer doesn't need repairing, inform false

     if (sourceContainer.hitsMax - sourceContainer.hits < workPartCount * REPAIR_POWER) return false

     // If the creep doesn't have enough energy and it hasn't yet moved resources, withdraw from the sourceContainer

     if (this.store.getUsedCapacity(RESOURCE_ENERGY) < workPartCount && !this.movedResource)
          this.withdraw(sourceContainer, RESOURCE_ENERGY)

     // If the creep has already worked, inform false

     if (this.worked) return false

     // Try to repair the target

     const repairResult = this.repair(sourceContainer)

     // If the repair worked

     if (repairResult === OK) {
          // Record that the creep has worked

          this.worked = true

          // Find the repair amount by finding the smaller of the creep's work and the progress left for the cSite divided by repair power

          const energySpentOnRepairs = Math.min(
               workPartCount,
               (sourceContainer.hitsMax - sourceContainer.hits) / REPAIR_POWER,
          )

          // Add control points to total controlPoints counter and say the success

          if (global.roomStats[this.room.name]) global.roomStats[this.room.name].eoro += energySpentOnRepairs
          this.say(`🔧${energySpentOnRepairs * REPAIR_POWER}`)

          // Inform success

          return true
     }

     // Inform failure

     return false
}
