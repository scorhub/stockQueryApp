let PORT = 3001;

let DATABASE_OPTIONS = {
    client: "mysql",
    connection: {
        host: "localhost",
        user: "root",
        password: "",
        database: "stockquery"
    }
};

module.exports = { DATABASE_OPTIONS, PORT };