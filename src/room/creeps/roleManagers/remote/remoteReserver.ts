import { remoteNeedsIndex } from 'international/constants'
import { RemoteReserver } from '../../creepClasses'

export function remoteReserverManager(room: Room, creepsOfRole: string[]) {
    for (const creepName of creepsOfRole) {
        const creep: RemoteReserver = Game.creeps[creepName]

        if (!creep.findRemote()) continue

        creep.say(creep.memory.remote)

        // If the creep is in the remote

        if (room.name === creep.memory.remote) {
            // Try to reserve the controller

            creep.advancedReserveController()
            continue
        }

        // Otherwise, make a moveRequest to it

        creep.createMoveRequest({
            origin: creep.pos,
            goal: {
                pos: new RoomPosition(25, 25, creep.memory.remote),
                range: 25,
            },
            avoidEnemyRanges: true,
            plainCost: 1,
        })

        continue
    }
}

RemoteReserver.prototype.findRemote = function () {
    if (this.memory.remote) return true

    const remoteNamesByEfficacy: string[] = Game.rooms[this.commune]?.get('remoteNamesByEfficacy')

    let roomMemory

    for (const roomName of remoteNamesByEfficacy) {
        roomMemory = Memory.rooms[roomName]

        if (roomMemory.needs[remoteNeedsIndex.remoteReserver] <= 0) continue

        this.memory.remote = roomName
        roomMemory.needs[remoteNeedsIndex.remoteReserver] -= 1

        return true
    }

    return false
}

RemoteReserver.prototype.isDying = function () {
    // Inform as dying if creep is already recorded as dying

    if (this.memory.dying) return true

    // Stop if creep is spawning

    if (!this.ticksToLive) return false

    if (this.memory.remote) if (this.ticksToLive > this.body.length * CREEP_SPAWN_TIME + Memory.rooms[this.memory.remote].RE - 1) return false

    else if (this.ticksToLive > this.body.length * CREEP_SPAWN_TIME) return false

    // Record creep as dying

    this.memory.dying = true
    return true
}
