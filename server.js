const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);

// WebSocket server in noServer mode.
// We handle the HTTP -> WebSocket upgrade ourselves.
const wss = new WebSocket.Server({
    noServer: true
});

const PORT = process.env.PORT || 3000;

// AMCAR Talk rooms
// roomCode -> Set of connected WebSocket clients
const rooms = new Map();


/*
 * NORMAL HTTP TEST
 */
app.get("/", (req, res) => {
    res.send("AMCAR Talk Server is running");
});


/*
 * WEBSOCKET UPGRADE
 *
 * This lets us see whether Render forwards
 * the WebSocket upgrade request to Node.
 */
server.on("upgrade", (request, socket, head) => {

    console.log("");
    console.log("==============================");
    console.log("WEBSOCKET UPGRADE RECEIVED");
    console.log("URL:", request.url);
    console.log("HOST:", request.headers.host);
    console.log("UPGRADE:", request.headers.upgrade);
    console.log("CONNECTION:", request.headers.connection);
    console.log("==============================");

    if (
        request.headers.upgrade?.toLowerCase() !== "websocket"
    ) {
        console.log("Rejected: not a WebSocket upgrade");

        socket.destroy();
        return;
    }

    wss.handleUpgrade(
        request,
        socket,
        head,
        (ws) => {

            console.log(
                "WEBSOCKET UPGRADE SUCCESSFUL"
            );

            wss.emit(
                "connection",
                ws,
                request
            );
        }
    );
});


/*
 * CREATE RANDOM 6-DIGIT ROOM CODE
 */
function createRoomCode() {

    let code;

    do {

        code =
            Math.floor(
                100000 +
                Math.random() * 900000
            ).toString();

    } while (rooms.has(code));

    return code;
}


/*
 * SEND JSON
 */
function send(ws, data) {

    if (
        ws.readyState ===
        WebSocket.OPEN
    ) {

        ws.send(
            JSON.stringify(data)
        );
    }
}


/*
 * SEND TO EVERYONE IN ROOM
 */
function broadcastRoom(
    roomCode,
    data,
    exceptClient = null
) {

    const room =
        rooms.get(roomCode);

    if (!room) {
        return;
    }

    for (const client of room) {

        if (
            client !== exceptClient &&
            client.readyState ===
                WebSocket.OPEN
        ) {

            send(
                client,
                data
            );
        }
    }
}


/*
 * UPDATE ROOM USER COUNT
 */
function sendRoomStatus(roomCode) {

    const room =
        rooms.get(roomCode);

    if (!room) {
        return;
    }

    broadcastRoom(
        roomCode,
        {
            type: "room_status",
            roomCode: roomCode,
            users: room.size
        }
    );
}


/*
 * REMOVE USER FROM CURRENT ROOM
 */
function leaveCurrentRoom(ws) {

    const roomCode =
        ws.roomCode;

    if (!roomCode) {
        return;
    }

    const room =
        rooms.get(roomCode);

    if (room) {

        room.delete(ws);

        if (
            room.size === 0
        ) {

            rooms.delete(
                roomCode
            );

            console.log(
                `Room ${roomCode} closed`
            );

        } else {

            sendRoomStatus(
                roomCode
            );
        }
    }

    ws.roomCode = null;
}


/*
 * WEBSOCKET CONNECTION
 */
wss.on(
    "connection",
    (ws, request) => {

        console.log("");
        console.log(
            "AMCAR user connected"
        );

        console.log(
            "Client:",
            request.socket.remoteAddress
        );

        ws.roomCode = null;


        /*
         * TELL ANDROID CONNECTION WORKED
         */
        send(
            ws,
            {
                type: "connected"
            }
        );


        /*
         * RECEIVE MESSAGE
         */
        ws.on(
            "message",
            (message) => {

                console.log(
                    "Message received:",
                    message.toString()
                );

                try {

                    const data =
                        JSON.parse(
                            message.toString()
                        );


                    /*
                     * CREATE ROOM
                     */
                    if (
                        data.type ===
                        "create_room"
                    ) {

                        leaveCurrentRoom(
                            ws
                        );

                        const roomCode =
                            createRoomCode();

                        const room =
                            new Set();

                        room.add(ws);

                        rooms.set(
                            roomCode,
                            room
                        );

                        ws.roomCode =
                            roomCode;

                        send(
                            ws,
                            {
                                type:
                                    "room_created",

                                roomCode:
                                    roomCode,

                                users: 1
                            }
                        );

                        console.log(
                            `Room ${roomCode} created`
                        );

                        return;
                    }


                    /*
                     * JOIN ROOM
                     */
                    if (
                        data.type ===
                        "join_room"
                    ) {

                        const roomCode =
                            String(
                                data.roomCode ||
                                ""
                            );

                        const room =
                            rooms.get(
                                roomCode
                            );

                        if (!room) {

                            send(
                                ws,
                                {
                                    type:
                                        "error",

                                    message:
                                        "Room not found"
                                }
                            );

                            return;
                        }

                        leaveCurrentRoom(
                            ws
                        );

                        room.add(ws);

                        ws.roomCode =
                            roomCode;

                        send(
                            ws,
                            {
                                type:
                                    "room_joined",

                                roomCode:
                                    roomCode,

                                users:
                                    room.size
                            }
                        );

                        sendRoomStatus(
                            roomCode
                        );

                        console.log(
                            `User joined room ${roomCode}. Users: ${room.size}`
                        );

                        return;
                    }


                    /*
                     * LEAVE ROOM
                     */
                    if (
                        data.type ===
                        "leave_room"
                    ) {

                        leaveCurrentRoom(
                            ws
                        );

                        send(
                            ws,
                            {
                                type:
                                    "room_left"
                            }
                        );

                        return;
                    }


                    /*
                     * WEBRTC SIGNALING
                     */
                    if (
                        data.type ===
                        "signal"
                    ) {

                        if (
                            !ws.roomCode
                        ) {
                            return;
                        }

                        broadcastRoom(
                            ws.roomCode,
                            {
                                type:
                                    "signal",

                                payload:
                                    data.payload
                            },
                            ws
                        );

                        return;
                    }


                    /*
                     * PUSH TO TALK EVENTS
                     */
                    if (
                        data.type ===
                            "ptt_start" ||
                        data.type ===
                            "ptt_end"
                    ) {

                        if (
                            !ws.roomCode
                        ) {
                            return;
                        }

                        broadcastRoom(
                            ws.roomCode,
                            {
                                type:
                                    data.type
                            },
                            ws
                        );
                    }

                } catch (error) {

                    console.error(
                        "Invalid message:",
                        error
                    );
                }
            }
        );


        /*
         * CONNECTION ERROR
         */
        ws.on(
            "error",
            (error) => {

                console.error(
                    "WebSocket error:",
                    error
                );
            }
        );


        /*
         * CONNECTION CLOSED
         */
        ws.on(
            "close",
            () => {

                leaveCurrentRoom(
                    ws
                );

                console.log(
                    "AMCAR user disconnected"
                );
            }
        );
    }
);


/*
 * START SERVER
 */
server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log("");
        console.log(
            "=============================="
        );

        console.log(
            " AMCAR TALK SERVER"
        );

        console.log(
            "=============================="
        );

        console.log(
            `Running on port ${PORT}`
        );

        console.log(
            `Open: http://localhost:${PORT}`
        );

        console.log(
            "WebSocket upgrade diagnostics ENABLED"
        );

        console.log(
            "=============================="
        );

        console.log("");
    }
);
