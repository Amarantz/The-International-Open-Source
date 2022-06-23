import { remoteNeedsIndex } from 'international/constants'
import { RemoteCoreAttacker } from 'room/creeps/creepClasses'

RemoteCoreAttacker.prototype.preTickManager = function () {
     if (!this.memory.remoteName) return

     const role = this.memory.role as 'remoteCoreAttacker'

     // Reduce remote need

     Memory.rooms[this.memory.remoteName].needs[remoteNeedsIndex[role]] -= 1

     const commune = Game.rooms[this.memory.communeName]
     if (!commune) return

     // Add the creep to creepsFromRoomWithRemote relative to its remote

     commune.creepsFromRoomWithRemote[this.memory.remoteName][role].push(this.name)
}
