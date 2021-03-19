//@ts-check
'use strict';
module.exports = (red) => {
    function playlistUpdate(config) {
        red.nodes.createNode(this, config);
        const node = this;
        this.on('input', function (msg) {
            msg.topic = "playlist_update";
            node.send(msg);
        });
    }

    red.nodes.registerType("Playlist Update", playlistUpdate);
}