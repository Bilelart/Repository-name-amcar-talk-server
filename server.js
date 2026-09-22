const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = 3000;

// AMCAR Talk rooms
// roomCode -> Set of connected WebSocket clients
const rooms = new Map();

app.get("/", (req, res) => {
    res.send("AMCAR Talk Server is running");
});

function createRoomCode() {
    let code;

    do {
        code = Math.floor(100000 + Math.random() * 900000).toString();
    } while (rooms.has(code));

    return code;
}

function send(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

function broadcastRoom(roomCode, data, exceptClient = null) {
    const room = rooms.get(roomCode);

    if (!room) {
        return;
    }

    for (const client of room) {
        if (
            client !== exceptClient &&
            client.readyState === WebSocket.OPEN
        ) {
            send(client, data);
        }
    }
}

function sendRoomStatus(roomCode) {
    const room = rooms.get(roomCode);

    if (!room) {
        return;
    }

    const userCount = room.size;

    broadcastRoom(roomCode, {
        type: "room_status",
        roomCode: roomCode,
        users: userCount
    });
}

function leaveCurrentRoom(ws) {
    const roomCode = ws.roomCode;

    if (!roomCode) {
        return;
    }

    const room = rooms.get(roomCode);

    if (room) {
        room.delete(ws);

        if (room.size === 0) {
            rooms.delete(roomCode);

            console.log(`Room ${roomCode} closed`);
        } else {
            sendRoomStatus(roomCode);
        }
    }

    ws.roomCode = null;
}

wss.on("connection", (ws) => {

    console.log("AMCAR user connected");

    ws.roomCode = null;

    send(ws, {
        type: "connected"
    });

    ws.on("message", (message) => {

        try {
            const data = JSON.parse(message.toString());

            /*
             * CREATE ROOM
             */
            if (data.type === "create_room") {

                leaveCurrentRoom(ws);

                const roomCode = createRoomCode();

                const room = new Set();
                room.add(ws);

                rooms.set(roomCode, room);

                ws.roomCode = roomCode;

                send(ws, {
                    type: "room_created",
                    roomCode: roomCode,
                    users: 1
                });

                console.log(`Room ${roomCode} created`);

                return;
            }

            /*
             * JOIN ROOM
             */
            if (data.type === "join_room") {

                const roomCode = String(data.roomCode || "");

                const room = rooms.get(roomCode);

                if (!room) {
                    send(ws, {
                        type: "error",
                        message: "Room not found"
                    });

                    return;
                }

                leaveCurrentRoom(ws);

                room.add(ws);
                ws.roomCode = roomCode;

                send(ws, {
                    type: "room_joined",
                    roomCode: roomCode,
                    users: room.size
                });

                sendRoomStatus(roomCode);

                console.log(
                    `User joined room ${roomCode}. Users: ${room.size}`
                );

                return;
            }

            /*
             * LEAVE ROOM
             */
            if (data.type === "leave_room") {

                leaveCurrentRoom(ws);

                send(ws, {
                    type: "room_left"
                });

                return;
            }

            /*
             * WEBRTC SIGNALING
             *
             * We will use this later for:
             * offer
             * answer
             * ICE candidates
             */
            if (data.type === "signal") {

                if (!ws.roomCode) {
                    return;
                }

                broadcastRoom(
                    ws.roomCode,
                    {
                        type: "signal",
                        payload: data.payload
                    },
                    ws
                );

                return;
            }

            /*
             * PUSH-TO-TALK EVENTS
             *
             * Audio comes later.
             */
            if (
                data.type === "ptt_start" ||
                data.type === "ptt_end"
            ) {

                if (!ws.roomCode) {
                    return;
                }

                broadcastRoom(
                    ws.roomCode,
                    {
                        type: data.type
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
    });

    ws.on("close", () => {

        leaveCurrentRoom(ws);

        console.log("AMCAR user disconnected");
    });
});

server.listen(PORT, "0.0.0.0", () => {

    console.log("");
    console.log("==============================");
    console.log(" AMCAR TALK SERVER");
    console.log("==============================");
    console.log(`Running on port ${PORT}`);
    console.log(`Open: http://localhost:${PORT}`);
    console.log("==============================");
    console.log("");
});