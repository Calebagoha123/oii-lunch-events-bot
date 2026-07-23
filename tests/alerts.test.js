jest.mock("axios");
const axios = require("axios");

const { sendAlert } = require("../src/alerts");

describe("sendAlert (GitHub issues)", () => {
  const OLD_ENV = process.env;
  let get, post;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    get = jest.fn();
    post = jest.fn();
    axios.create = jest.fn(() => ({ get, post }));
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.restoreAllMocks();
  });

  test("no-ops (returns false) when GitHub isn't configured", async () => {
    delete process.env.GITHUB_REPO;
    delete process.env.GITHUB_TOKEN;
    const ok = await sendAlert("Boom", "details");
    expect(ok).toBe(false);
    expect(axios.create).not.toHaveBeenCalled();
  });

  test("opens a new labelled issue when none is open", async () => {
    process.env.GITHUB_REPO = "owner/repo";
    process.env.GITHUB_TOKEN = "t";
    get.mockResolvedValue({ data: [] });
    post.mockResolvedValue({ data: { number: 7 } });

    const ok = await sendAlert("Startup failed", "the stack trace");

    expect(ok).toBe(true);
    expect(post).toHaveBeenCalledWith(
      "/issues",
      expect.objectContaining({
        title: "[lunch-bot] Startup failed",
        body: "the stack trace",
        labels: ["bot-alert"],
      }),
    );
  });

  test("comments on the existing open issue instead of duplicating", async () => {
    process.env.GITHUB_REPO = "owner/repo";
    process.env.GITHUB_TOKEN = "t";
    get.mockResolvedValue({
      data: [{ number: 42, title: "[lunch-bot] Degraded sources" }],
    });
    post.mockResolvedValue({ data: {} });

    const ok = await sendAlert("Degraded sources", "schwarzman down");

    expect(ok).toBe(true);
    expect(post).toHaveBeenCalledWith(
      "/issues/42/comments",
      expect.objectContaining({ body: expect.stringContaining("schwarzman down") }),
    );
  });

  test("ignores a matching pull request (only real issues de-dupe)", async () => {
    process.env.GITHUB_REPO = "owner/repo";
    process.env.GITHUB_TOKEN = "t";
    get.mockResolvedValue({
      data: [{ number: 9, title: "[lunch-bot] Boom", pull_request: {} }],
    });
    post.mockResolvedValue({ data: { number: 10 } });

    await sendAlert("Boom", "x");

    expect(post).toHaveBeenCalledWith("/issues", expect.objectContaining({ labels: ["bot-alert"] }));
  });

  test("returns false and never throws on an API error", async () => {
    process.env.GITHUB_REPO = "owner/repo";
    process.env.GITHUB_TOKEN = "t";
    get.mockRejectedValue({ response: { status: 401, data: { message: "Bad credentials" } } });

    const ok = await sendAlert("Boom", "x");
    expect(ok).toBe(false);
  });
});
