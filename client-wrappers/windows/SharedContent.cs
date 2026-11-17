using System;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using Windows.ApplicationModel;
using Windows.ApplicationModel.Activation;
using Windows.ApplicationModel.DataTransfer;
using Windows.ApplicationModel.DataTransfer.ShareTarget;

namespace SevenFriends;

/// <summary>
/// What another app shares with Seven Friends from the Windows share dialog (a link, some text, or both). Only the MSIX package has the share target
/// (client-wrappers/windows/msix/AppxManifest.xml); the installer version is not packaged and never gets one.
/// The shared content is untrusted: it is cut to a size, cleaned of control characters and only handed to the web app's own page
/// <c>/share-in</c> as parameters; the person chooses the friend there and sends it himself, nothing is sent from here.
/// </summary>
public sealed record SharedContent(string Title, string Text, string Url)
{
    private const int MaxLength = 4000;
    private const string PipeName = "io.sevenfriends.app.share";

    [JsonIgnore]
    public bool IsEmpty => Text.Length == 0 && Url.Length == 0;

    /// <summary>The page of the web app that receives it: <c>/share-in?title=..&amp;text=..&amp;url=..</c> (every value encoded).</summary>
    [JsonIgnore]
    public string Path
    {
        get
        {
            static string Part(string key, string value) => value.Length == 0 ? "" : $"&{key}={Uri.EscapeDataString(value)}";
            return "/share-in?" + (Part("title", Title) + Part("text", Text) + Part("url", Url)).TrimStart('&');
        }
    }

    /// <summary>A shared value as plain text: no control characters (a new line stays), at most <see cref="MaxLength"/> characters.</summary>
    private static string Clean(string? value)
    {
        var text = new string((value ?? "").Where(c => c == '\n' || !char.IsControl(c)).ToArray()).Trim();
        return text.Length > MaxLength ? text[..MaxLength] : text;
    }

    public static SharedContent Of(string? title, string? text, string? url) => new(Clean(title), Clean(text), Clean(url));

    // ------------------------------------------------------------------ reading what Windows hands over

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetCurrentPackageFullName(ref int length, StringBuilder? name);

    /// <summary>True when the app runs from the MSIX package (the installer version has no package, and none of the Windows share APIs).</summary>
    public static bool IsPackaged()
    {
        var length = 0;
        return GetCurrentPackageFullName(ref length, null) != 15700; // APPMODEL_ERROR_NO_PACKAGE
    }

    /// <summary>The content Windows started this copy of the app with, or null when it was started in the ordinary way.</summary>
    public static SharedContent? FromActivation()
    {
        if (!IsPackaged()) return null;
        try
        {
            // the Windows calls wait for the message loop of their own thread: a worker thread, never the window's one
            return Task.Run(ReadAsync).GetAwaiter().GetResult();
        }
        catch
        {
            return null; // a share that cannot be read is not worth stopping the app for
        }
    }

    private static async Task<SharedContent?> ReadAsync()
    {
        if (AppInstance.GetActivatedEventArgs() is not ShareTargetActivatedEventArgs args) return null;
        var operation = args.ShareOperation;
        try
        {
            var data = operation.Data;
            string? text = null, url = null;
            if (data.Contains(StandardDataFormats.Text)) text = await data.GetTextAsync();
            if (data.Contains(StandardDataFormats.WebLink)) url = (await data.GetWebLinkAsync())?.AbsoluteUri;
            // a browser may send the address as the older "Uri" format only
#pragma warning disable CS0618
            else if (data.Contains(StandardDataFormats.Uri)) url = (await data.GetUriAsync())?.AbsoluteUri;
#pragma warning restore CS0618
            var content = Of(data.Properties.Title, text, url);
            return content.IsEmpty ? null : content;
        }
        finally
        {
            operation.ReportCompleted(); // tells Windows the share is taken, so its dialog can close
        }
    }

    // ------------------------------------------------------------------ the copy that is already running

    /// <summary>
    /// A second start (a share while the app is running) hands the content to the first copy through a pipe that only this person can reach, and ends.
    /// Returns false when the first copy could not be reached.
    /// </summary>
    public bool SendToRunningApp()
    {
        try
        {
            using var pipe = new NamedPipeClientStream(".", PipeName, PipeDirection.Out);
            pipe.Connect(3000);
            using var writer = new StreamWriter(pipe, new UTF8Encoding(false));
            writer.Write(System.Text.Json.JsonSerializer.Serialize(this));
            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>The first copy listens for what a second start hands over; <paramref name="received"/> runs once for each (on another thread).</summary>
    public static void Listen(Action<SharedContent> received) =>
        new Thread(() =>
        {
            while (true)
            {
                try
                {
                    using var pipe = new NamedPipeServerStream(PipeName, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.CurrentUserOnly);
                    pipe.WaitForConnection();
                    using var reader = new StreamReader(pipe, new UTF8Encoding(false));
                    var raw = reader.ReadToEnd();
                    var sent = raw.Length <= 5 * MaxLength ? System.Text.Json.JsonSerializer.Deserialize<SharedContent>(raw) : null;
                    // cleaned again: whatever came through the pipe is as untrusted as the share itself
                    if (sent is not null && Of(sent.Title, sent.Text, sent.Url) is { IsEmpty: false } content) received(content);
                }
                catch
                {
                    Thread.Sleep(500); // a broken connection: listen again
                }
            }
        }) { IsBackground = true }.Start();
}
