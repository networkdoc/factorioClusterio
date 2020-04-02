const assert = require("assert").strict;
const events = require("events");
const fs = require("fs-extra");
const path = require("path");

const factorio = require("lib/factorio");
const { testLines } = require("./lines");


describe("lib/factorio/server", function() {
	describe("_getVersion()", function() {
		it("should get the version from a changelog", async function() {
			let version = await factorio._getVersion(path.join("test", "file", "changelog-test.txt"));
			assert.equal(version, "0.1.1");
		});
		it("should throw if unable to find the version", async function() {
			await assert.rejects(
				factorio._getVersion(path.join("test", "file", "changelog-bad.txt")),
				new Error("Unable to determine the version of Factorio")
			);
		});
	});

	describe("randomDynamicPort()", function() {
		it("should return a port number", function() {
			let port = factorio._randomDynamicPort()
			assert.equal(typeof port, "number");
			assert(Number.isInteger(port));
			assert(0 <= port && port < 2**16);
		});

		it("should return a port number in the dynamic range", function() {
			function validate(port) {
				return 49152 <= port && port <= 65535;
			}
			for (let i=0; i < 20; i++) {
				assert(validate(factorio._randomDynamicPort()));
			}
		});
	});

	describe("generatePassword()", function() {
		it("should return a string", async function() {
			let password = await factorio._generatePassword(1);
			assert.equal(typeof password, "string");
		});

		it("should return a string of the given length", async function() {
			let password = await factorio._generatePassword(10);
			assert.equal(password.length, 10);
		});

		it("should contain only a-z, A-Z, 0-9", async function() {
			let password = await factorio._generatePassword(10);
			assert(/^[a-zA-Z0-9]+$/.test(password), `${password} failed test`);
		});
	});

	describe("class LineSplitter", function() {
		function createSplitter(lines) {
			return new factorio._LineSplitter(line => lines.push(line.toString("utf-8")));
		}

		it("should split three lines", function() {
			let lines = [];
			let ls = createSplitter(lines);
			ls.data(Buffer.from("line 1\nline 2\nline 3\n"));
			ls.end();
			assert.deepEqual(lines, ["line 1", "line 2", "line 3"]);
		});
		it("should split three Windows line endings lines", function() {
			let lines = [];
			let ls = createSplitter(lines);
			ls.data(Buffer.from("line 1\r\nline 2\r\nline 3\r\n"));
			assert.deepEqual(lines, ["line 1", "line 2", "line 3"]);
		});
		it("should give the last non-terminated line on .end()", function() {
			let lines = [];
			let ls = createSplitter(lines);
			ls.data(Buffer.from("line a\nline b"));
			assert.deepEqual(lines, ["line a"]);
			ls.end();
			assert.deepEqual(lines, ["line a", "line b"]);
		});
		it("should handled partial lines", function() {
			let lines = [];
			let ls = createSplitter(lines);
			ls.data(Buffer.from("part 1"));
			ls.data(Buffer.from(" part 2 "));
			ls.data(Buffer.from("part 3\n"));
			ls.end();
			assert.deepEqual(lines, ["part 1 part 2 part 3"]);
		});
	});

	describe("parseOutput()", function() {
		it("should parse the test lines", function() {
			for (let [line, reference] of testLines) {
				reference.source = 'test';
				let output = factorio._parseOutput(line, 'test');
				delete output.received;
				assert.deepEqual(output, reference);
			}
		});
	});

	describe("class FactorioServer", function() {
		let writePath = path.join("test", "temp", "should_not_exist");
		let server = new factorio.FactorioServer(path.join("test", "file", "factorio", "data"), writePath, {});

		describe(".init()", function() {
			it("should not throw on first call", async function() {
				await server.init();
			});

			it("should throw if called twice", async function() {
				await assert.rejects(server.init(), new Error("Expected state new but state is init"));
			});
		});

		describe(".version", function() {
			it("should return the version detected", function() {
				assert.equal(server.version, "0.1.1");
			});
		});

		describe("._handleIpc()", function() {
			it("should emit the correct ipc event", async function() {
				let waiter = events.once(server, 'ipc-channel');
				await server._handleIpc(Buffer.from('\f$ipc:channel?j"value"'));
				let result = await waiter;
				assert.equal(result[0], "value");
			});
			it("should handle special characters in channel name", async function() {
				let waiter = events.once(server, 'ipc-$ ?\x00\x0a:');
				await server._handleIpc(Buffer.from('\f$ipc:$ \\x3f\\x00\\x0a:?j"value"'));
				let result = await waiter;
				assert.equal(result[0], "value");
			});
			it("should throw on malformed ipc line", async function() {
				await assert.rejects(
					server._handleIpc(Buffer.from('\f$ipc:blah')),
					new Error('Malformed IPC line "\f$ipc:blah"')
				);
			})
			it("should throw on unknown type", async function() {
				await assert.rejects(
					server._handleIpc(Buffer.from('\f$ipc:channel??')),
					new Error("Unknown IPC type '?'")
				);
			})
			it("should throw on unknown file type", async function() {
				await assert.rejects(
					server._handleIpc(Buffer.from('\f$ipc:channel?ffoo.invalid')),
					new Error("Unknown IPC file format 'invalid'")
				);
			})
			it("should throw on file name with slash", async function() {
				await assert.rejects(
					server._handleIpc(Buffer.from('\f$ipc:channel?fa/b')),
					new Error("Invalid IPC file name 'a/b'")
				);
			})
			it("should load and delete json file", async function() {
				let filePath = server.writePath('script-output', 'data.json');
				await fs.outputFile(filePath, '{"data":"spam"}');
				let waiter = events.once(server, 'ipc-channel');
				await server._handleIpc(Buffer.from('\f$ipc:channel?fdata.json'));
				let result = await waiter;
				assert.deepEqual(result[0], { "data": "spam" });
				assert(!await fs.pathExists(filePath), "File was not deleted");
			})
		});
	});
});