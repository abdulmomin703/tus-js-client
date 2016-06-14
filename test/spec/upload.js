/* global FakeBlob tus */

var isBrowser  = typeof window !== "undefined";
var isNode     = !isBrowser;
var hasRequire = typeof require == "function";
var hasStorage = tus.canStoreURLs;

function expectLocalStorage(key, expectedValue) {
  if (!hasStorage) {
    // Do not evaluate expectations on localStorage in node processes
    return;
  }

  expect(localStorage.getItem(key), expectedValue);
}

function setLocalStorage(key, value) {
  if (!hasStorage) {
    // Do not evaluate expectations on localStorage in node processes
    return;
  }

  localStorage.setItem(key, value);
}

function clearLocalStorage() {
  if (!hasStorage) {
    // Do not evaluate expectations on localStorage in node processes
    return;
  }

  localStorage.clear();
}

describe("tus", function () {
  describe("#Upload", function () {

    beforeEach(function () {
      jasmine.Ajax.install();
      clearLocalStorage();
    });

    afterEach(function () {
      jasmine.Ajax.uninstall();
    });

    it("should throw if no error handler is available", function () {
      var upload = new tus.Upload(null);
      expect(upload.start).toThrow();
    });

    it("should upload a file", function (done) {
      var file = new FakeBlob("hello world".split(""));
      var options = {
        endpoint: "/uploads",
        headers: {
          Custom: "blargh"
        },
        metadata: {
          foo: "hello",
          bar: "world",
          nonlatin: "słońce"
        },
        withCredentials: true,
        onProgress: function () {},
        fingerprint: function () {}
      };
      spyOn(options, "fingerprint").and.returnValue("fingerprinted");
      spyOn(options, "onProgress");

      var upload = new tus.Upload(file, options);
      upload.start();

      expect(options.fingerprint).toHaveBeenCalledWith(file);

      var req = jasmine.Ajax.requests.mostRecent();
      expect(req.url).toBe("/uploads");
      expect(req.method).toBe("POST");
      expect(req.requestHeaders.Custom).toBe("blargh");
      expect(req.requestHeaders["Tus-Resumable"]).toBe("1.0.0");
      expect(req.requestHeaders["Upload-Length"]).toBe(file.size);
      if (isBrowser) expect(req.withCredentials).toBe(true);
      if (isNode || (isBrowser && "btoa" in window)) {
        expect(req.requestHeaders["Upload-Metadata"]).toBe("foo aGVsbG8=,bar d29ybGQ=,nonlatin c8WCb8WEY2U=");
      }

      req.respondWith({
        status: 201,
        responseHeaders: {
          Location: "/uploads/blargh"
        }
      });

      expect(upload.url).toBe("/uploads/blargh");

      expectLocalStorage("fingerprinted", "/uploads/blargh");

      req = jasmine.Ajax.requests.mostRecent();
      expect(req.url).toBe("/uploads/blargh");
      expect(req.method).toBe("PATCH");
      expect(req.requestHeaders.Custom).toBe("blargh");
      expect(req.requestHeaders["Tus-Resumable"]).toBe("1.0.0");
      expect(req.requestHeaders["Upload-Offset"]).toBe(0);
      expect(req.contentType()).toBe("application/offset+octet-stream");
      expect(req.params.size).toBe(file.size);
      if (isBrowser) expect(req.withCredentials).toBe(true);

      req.respondWith({
        status: 204,
        responseHeaders: {
          "Upload-Offset": file.size
        }
      });

      expect(options.onProgress).toHaveBeenCalledWith(11, 11);
      done();
    });

    it("should resume an upload", function (done) {
      // Only execute this test if we are in an browser environment as it relys
      // on localStorage
      if (!hasStorage) pending("test requires storage and localStorage is unavailable");

      setLocalStorage("fingerprinted", "/uploads/resuming");

      var file = new FakeBlob("hello world".split(""));
      var options = {
        endpoint: "/uploads",
        onProgress: function () {},
        fingerprint: function () {}
      };
      spyOn(options, "fingerprint").and.returnValue("fingerprinted");
      spyOn(options, "onProgress");

      var upload = new tus.Upload(file, options);
      upload.start();

      expect(options.fingerprint).toHaveBeenCalledWith(file);

      var req = jasmine.Ajax.requests.mostRecent();
      expect(req.url).toBe("/uploads/resuming");
      expect(req.method).toBe("HEAD");
      expect(req.requestHeaders["Tus-Resumable"]).toBe("1.0.0");

      req.respondWith({
        status: 204,
        responseHeaders: {
          "Upload-Length": 11,
          "Upload-Offset": 3
        }
      });

      expect(upload.url).toBe("/uploads/resuming");

      req = jasmine.Ajax.requests.mostRecent();
      expect(req.url).toBe("/uploads/resuming");
      expect(req.method).toBe("PATCH");
      expect(req.requestHeaders["Tus-Resumable"]).toBe("1.0.0");
      expect(req.requestHeaders["Upload-Offset"]).toBe(3);
      expect(req.contentType()).toBe("application/offset+octet-stream");
      expect(req.params.size).toBe(file.size - 3);

      req.respondWith({
        status: 204,
        responseHeaders: {
          "Upload-Offset": file.size
        }
      });

      expect(options.onProgress).toHaveBeenCalledWith(11, 11);
      done();
    });

    it("should create an upload if resuming fails", function (done) {
      // Only execute this test if we are in an browser environment as it relys
      // on localStorage
      if (!hasStorage) pending("test requires storage and localStorage is unavailable");

      setLocalStorage("fingerprinted", "/uploads/resuming");

      var file = new FakeBlob("hello world".split(""));
      var options = {
        endpoint: "/uploads",
        fingerprint: function () {}
      };
      spyOn(options, "fingerprint").and.returnValue("fingerprinted");

      var upload = new tus.Upload(file, options);
      upload.start();

      expect(options.fingerprint).toHaveBeenCalledWith(file);

      var req = jasmine.Ajax.requests.mostRecent();
      expect(req.url).toBe("/uploads/resuming");
      expect(req.method).toBe("HEAD");
      expect(req.requestHeaders["Tus-Resumable"]).toBe("1.0.0");

      req.respondWith({
        status: 404
      });

      expect(upload.url).toBe(null);

      req = jasmine.Ajax.requests.mostRecent();
      expect(req.url).toBe("/uploads");
      expect(req.method).toBe("POST");
      expect(req.requestHeaders["Tus-Resumable"]).toBe("1.0.0");
      expect(req.requestHeaders["Upload-Length"]).toBe(11);
      done();
    });

    it("should upload a file in chunks", function (done) {
      var file = new FakeBlob("hello world".split(""));
      var options = {
        endpoint: "/uploads",
        chunkSize: 7,
        onProgress: function () {},
        onChunkComplete: function () {},
        fingerprint: function () {}
      };
      spyOn(options, "fingerprint").and.returnValue("fingerprinted");
      spyOn(options, "onProgress");
      spyOn(options, "onChunkComplete");

      var upload = new tus.Upload(file, options);
      upload.start();

      expect(options.fingerprint).toHaveBeenCalledWith(file);

      var req = jasmine.Ajax.requests.mostRecent();
      expect(req.url).toBe("/uploads");
      expect(req.method).toBe("POST");
      expect(req.requestHeaders["Tus-Resumable"]).toBe("1.0.0");
      expect(req.requestHeaders["Upload-Length"]).toBe(file.size);

      req.respondWith({
        status: 201,
        responseHeaders: {
          Location: "/uploads/blargh"
        }
      });

      expect(upload.url).toBe("/uploads/blargh");

      expectLocalStorage("fingerprinted", "/uploads/blargh");

      req = jasmine.Ajax.requests.mostRecent();
      expect(req.url).toBe("/uploads/blargh");
      expect(req.method).toBe("PATCH");
      expect(req.requestHeaders["Tus-Resumable"]).toBe("1.0.0");
      expect(req.requestHeaders["Upload-Offset"]).toBe(0);
      expect(req.contentType()).toBe("application/offset+octet-stream");
      expect(req.params.size).toBe(7);

      req.respondWith({
        status: 204,
        responseHeaders: {
          "Upload-Offset": 7
        }
      });

      req = jasmine.Ajax.requests.mostRecent();
      expect(req.url).toBe("/uploads/blargh");
      expect(req.method).toBe("PATCH");
      expect(req.requestHeaders["Tus-Resumable"]).toBe("1.0.0");
      expect(req.requestHeaders["Upload-Offset"]).toBe(7);
      expect(req.contentType()).toBe("application/offset+octet-stream");
      expect(req.params.size).toBe(4);

      req.respondWith({
        status: 204,
        responseHeaders: {
          "Upload-Offset": file.size
        }
      });
      expect(options.onProgress).toHaveBeenCalledWith(11, 11);
      expect(options.onChunkComplete).toHaveBeenCalledWith(7, 7, 11);
      expect(options.onChunkComplete).toHaveBeenCalledWith(4, 11, 11);
      done();
    });

    it("should add the original request to errors", function () {
      var file = new FakeBlob("hello world".split(""));
      var err;
      var options = {
        endpoint: "/uploads",
        onError: function (e) {
          err = e;
        }
      };

      var upload = new tus.Upload(file, options);
      upload.start();

      var req = jasmine.Ajax.requests.mostRecent();
      expect(req.url).toBe("/uploads");
      expect(req.method).toBe("POST");

      req.respondWith({
        status: 500,
        responseHeaders: {
          Custom: "blargh"
        }
      });

      expect(upload.url).toBe(null);

      expect(err.message).toBe("tus: unexpected response while creating upload");
      expect(err.originalRequest).toBeDefined();
      expect(err.originalRequest.getResponseHeader("Custom")).toBe("blargh");
    });

    it("should not resume a finished upload", function (done) {
      // Only execute this test if we are in an browser environment as it relys
      // on localStorage
      if (!hasStorage) pending("test requires storage and localStorage is unavailable");

      setLocalStorage("fingerprinted", "/uploads/resuming");

      var file = new FakeBlob("hello world".split(""));
      var options = {
        endpoint: "/uploads",
        onProgress: function () {},
        onSuccess: function () {},
        fingerprint: function () {}
      };
      spyOn(options, "fingerprint").and.returnValue("fingerprinted");
      spyOn(options, "onProgress");
      spyOn(options, "onSuccess");

      var upload = new tus.Upload(file, options);
      upload.start();

      expect(options.fingerprint).toHaveBeenCalledWith(file);

      var req = jasmine.Ajax.requests.mostRecent();
      expect(req.url).toBe("/uploads/resuming");
      expect(req.method).toBe("HEAD");
      expect(req.requestHeaders["Tus-Resumable"]).toBe("1.0.0");

      req.respondWith({
        status: 204,
        responseHeaders: {
          "Upload-Length": "11",
          "Upload-Offset": "11"
        }
      });

      expect(options.onProgress).toHaveBeenCalledWith(11, 11);
      expect(options.onSuccess).toHaveBeenCalled();
      done();
    });

    it("should resume an upload from a specified url", function (done) {
      var file = new FakeBlob("hello world".split(""));
      var options = {
        endpoint: "/uploads",
        uploadUrl: "/files/upload",
        onProgress: function () {},
        fingerprint: function () {}
      };
      spyOn(options, "fingerprint").and.returnValue("fingerprinted");
      spyOn(options, "onProgress");

      var upload = new tus.Upload(file, options);
      upload.start();

      expect(options.fingerprint.calls.count()).toEqual(0);
      expect(upload.url).toBe("/files/upload");

      var req = jasmine.Ajax.requests.mostRecent();
      expect(req.url).toBe("/files/upload");
      expect(req.method).toBe("HEAD");
      expect(req.requestHeaders["Tus-Resumable"]).toBe("1.0.0");

      req.respondWith({
        status: 204,
        responseHeaders: {
          "Upload-Length": 11,
          "Upload-Offset": 3
        }
      });

      req = jasmine.Ajax.requests.mostRecent();
      expect(req.url).toBe("/files/upload");
      expect(req.method).toBe("PATCH");
      expect(req.requestHeaders["Tus-Resumable"]).toBe("1.0.0");
      expect(req.requestHeaders["Upload-Offset"]).toBe(3);
      expect(req.contentType()).toBe("application/offset+octet-stream");
      expect(req.params.size).toBe(file.size - 3);

      req.respondWith({
        status: 204,
        responseHeaders: {
          "Upload-Offset": file.size
        }
      });

      expect(options.onProgress).toHaveBeenCalledWith(11, 11);
      done();
    });
  });
});
