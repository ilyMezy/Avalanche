# Avalanche

A desktop workspace for studying and writing: documents, slides, notes, flashcards, a planner, and a
focus timer in one app for Windows, macOS, and Linux. Everything is stored on your own computer as ordinary files. There is
no account and nothing is uploaded.

## Download

Get the latest version from the [Releases page](https://github.com/ilymezy/Avalanche/releases/latest).
Under **Assets**, pick the file for your computer:

| Your computer | Download |
|---|---|
| Windows 10 or 11 | `Avalanche-Setup-<version>.exe`, then run it |
| Mac with Apple silicon (M1 or later) | `Avalanche-<version>-mac-arm64.dmg` |
| Mac with an Intel processor | `Avalanche-<version>-mac-x64.dmg` |
| Linux | `Avalanche-<version>-linux-x86_64.AppImage` (any distribution), or the `.deb` for Debian and Ubuntu |

Not sure which Mac you have? Apple menu → **About This Mac**: "Chip: Apple M…" means Apple silicon.

On Linux, make the AppImage runnable once (right-click → Properties → Allow executing, or
`chmod +x` in a terminal), then double-click it.

**Windows:** the installer is not code-signed yet, so SmartScreen may say "Windows protected your
PC". Choose **More info → Run anyway**.

> **A note for Mac users.** Avalanche is not yet signed by Apple, so the first time you open it macOS
> will refuse with a message that it "can't be opened" or "cannot be verified". To open it anyway:
> drag Avalanche to **Applications**, try to open it once, then go to **System Settings → Privacy &
> Security**, scroll down, and click **Open Anyway** next to Avalanche. You only do this once. If
> macOS instead says the app "is damaged", open Terminal and run
> `xattr -cr /Applications/Avalanche.app`, then open it again.
>
> On a Mac the app does not check for updates yet. Look at the Releases page now and then, and to
> update, download the new version and drag it into **Applications** to replace the old one. Your
> documents and data are kept.

On Windows and with the Linux AppImage, Avalanche tells you when a newer version is out and can
update itself.

## What is in it

| | |
|---|---|
| **Documents** | A word processor that saves real `.docx` files. |
| **Slides** | A slide editor that saves real `.pptx` files, with a presentation mode. |
| **Notes** | Markdown notes with live preview, and one-click quick notes. |
| **LaTeX** | Write papers and compile them to PDF. |
| **Flashcards** | Decks with spaced repetition, made by hand or straight from your notes. |
| **Planner** | Tasks and reminders, as lists or on a month calendar. |
| **Focus** | A Pomodoro timer. |
| **Home** | A start page you arrange yourself. |

## Getting started

Press `Ctrl+N` (or the **New** button) to create a document, a set of slides, a note, or a LaTeX
project. Everything saves by itself as you work. Open items appear as tabs along the top; the sidebar
takes you between Home, Documents, Quick Notes, Flashcards, Planner, and Focus.

Your work lives in a workspace folder, **Avalanche** inside your Documents folder, unless you choose another in Settings.
The files in it are normal `.docx`, `.pptx`, and `.md` files in normal folders, so you can open them in
other programs, copy them to a USB stick, or back them up however you like.

## Documents

A word processor for essays, reports, and assignments.

- Headings, fonts and sizes, bold, italic, underline, alignment, lists, quotes, links, tables, and images.
- **Page break** (`Ctrl+Enter`) starts a new page.
- **Symbol** (the Ω button) inserts special characters: maths, Greek letters, arrows, currency, and
  accented letters. Search by name, for example "alpha".
- **Whiteboard** opens a drawing board for diagrams and sketches. The drawing is placed in the
  document, and you can reopen it later to change it.
- **Export as PDF** saves a copy for printing or handing in.
- Files open in Microsoft Word, and Word files open here.

### Help while you write

- **Sums.** Type a sum followed by `=` and a space and the answer appears: `12*4= ` becomes `12*4=48`.
  Brackets, powers (`^`), percentages, `sqrt`, and `pi` all work.
- **Corrections.** Common slips such as "teh" and "dont" are fixed as you type, and sentences are
  capitalized.
- **Word completion.** When you start a word you have already used in the document, the rest appears
  in grey. Press `Tab` to accept it.
- **Spelling.** Misspelled words are underlined; right-click one for suggestions. (On Linux, spell
  checking is not available yet.)
- **Check writing** lists grammar and punctuation slips (repeated words, "should of", a missing
  capital, and similar) with a button to fix each one, or all at once.

These follow fixed rules for English and run entirely on your computer. They are not an AI model and
will not catch everything. Each one can be switched off in **Settings → Writing help**.

## Slides

Build a presentation from one of seven templates or from a blank deck.

- The **Elements** panel adds headings, body text, bulleted lists, pictures, shapes (rectangles,
  circles, triangles, stars, arrows, and more), and lines.
- The **Layouts** panel adds ready-made slides (title, two columns, quote, big number, and others),
  changes the style of the whole deck, and turns slide numbers on.
- Drag an element to move it; it snaps to the centre and edges of the slide. Drag the corner to
  resize and the round handle to rotate. Double-click text to edit it.
- Choose fonts, colours, outlines, and transparency from the toolbar. Each slide has its own
  background colour and speaker notes.
- **Present** shows the slides one at a time. Use the arrow keys or Space to move, and `Esc` to leave.

Presentations made in PowerPoint can be opened and edited. Text, pictures, common shapes, and notes
come across; themes, tables, charts, and animations do not, and the original file is kept safe before
your first save.

A PDF opens as a slide viewer you can present from. **Convert to editable slides** makes a new
presentation with each page as a slide you can write and draw on top of.

## Notes and LaTeX

**Markdown notes** are plain-text notes with optional live preview beside them. **Quick Notes** in the
sidebar creates one in a single click, for when you just need to write something down.

**LaTeX projects** are for papers with equations and references. Avalanche compiles them and shows the
PDF next to the source. This needs a TeX distribution installed on your computer (MiKTeX on Windows,
MacTeX on a Mac, TeX Live on Linux); the editor works without one, but compiling does not.

## Flashcards

Decks of question-and-answer cards, reviewed with spaced repetition: cards you find hard come back
soon, and cards you know well come back less and less often.

**Making cards**

- Add cards one at a time inside a deck, or
- import a CSV or TSV file, or
- write them in your notes. Select the text and press `Ctrl+Shift+K`; every line written with an
  arrow becomes a card:

  | You write | You get |
  |---|---|
  | `What is osmosis -> Water moving across a membrane` | One card |
  | `chien <-> dog` | Two cards, one in each direction |

  You see the cards and can edit them before anything is saved.

**Studying**

Press **Study** on a deck. Read the question, press `Space` to see the answer, then say how well you
remembered it with `1` (again), `2` (hard), `3` (good), or `4` (easy). That decides when the card
returns. **Edit card** is there during a session if you spot a mistake.

When a deck has nothing due, the button reads **Practise**: it goes through every card as many times
as you like without changing the schedule.

**Organizing**

Decks can hold subdecks. Click a deck's icon to choose from about a hundred icons, searchable by
subject, in nine colours.

## Planner

Tasks with optional due dates, times, and reminders.

- **Today**, **Upcoming**, **All**, and **Completed** show your tasks as lists.
- **Calendar** shows a month with each task on its day. Click a day to see it and add a task there;
  drag a task to another day to reschedule it.
- **Reminders** can be one-off or repeat daily, weekly, or monthly. They appear as system
  notifications.
- From a document or note, select some text and choose **Add selection to planner**
  (`Ctrl+Shift+D`). A date written in the text, such as "tomorrow at 5pm" or "on Friday", is filled
  in for you to confirm.

## Focus

A Pomodoro timer: work for a set time, take a short break, and take a longer break after a few
rounds. Change the lengths with the settings button. A small timer stays in the top bar while you
work in other parts of the app, and the timer keeps correct time if you close the app or the
computer sleeps.

## Home

The start page greets you with shortcuts for creating things and three counters: tasks due, cards to
study, and focus sessions today.

Below them are widgets you arrange yourself. Choose **Customize** to reorder them, move them between
the two columns, remove them, or add more:

- **Goals**: things to tick off, or to count towards a number ("Read 12 chapters") with a progress bar
- **Picture**: any image of your own, with a caption
- **Note**: free text that saves as you type
- **Clock**, **Countdown** to a date you choose, **Focus timer**, **Mini calendar**, and **Year progress**
- Recent documents, folders, today's tasks, reminders, and recent quick notes

## Files and folders

**Documents** in the sidebar is a file browser for your workspace.

- Create folders and subfolders, rename, move by dragging, and mark favourites.
- Inside a folder, **Back to …** and the path at the top take you back up. So does `Alt+Left`.
- **Add files** copies existing `.docx`, `.pptx`, `.pdf`, and `.md` files into the current folder.
- Deleted items go to the trash, where they can be restored.
- `Ctrl+P` jumps to any document or folder by typing part of its name.

## Appearance

**Settings → Appearance** has eight themes, light and dark, and an optional accent colour.
**Interface size** makes everything in the window larger or smaller. **Settings → Home → Greeting
background** puts a picture of your own behind the greeting at the top of Home.

## Keyboard shortcuts

On a Mac, use **⌘ Cmd** wherever this list says **Ctrl**, and **⌥ Option** for **Alt**.

| Shortcut | Action |
|---|---|
| `Ctrl+N` | New document, slides, note, or LaTeX project |
| `Ctrl+P` | Jump to a document or folder by name |
| `Ctrl+K` | Search everything and run commands |
| `Ctrl+S` | Save now (everything also saves automatically) |
| `Ctrl+W`, `Ctrl+Tab` | Close tab, next tab |
| `Ctrl+\` | Show or hide the sidebar |
| `Ctrl+,` | Settings |
| `Ctrl+Shift+K` | Make flashcards from the selection |
| `Ctrl+Shift+D` | Add the selection to the planner |
| `Ctrl+Enter` | Page break in a document; compile in LaTeX |
| `Alt+Left` | Up one folder in Documents |
| `Space`, then `1`–`4` | Flip a flashcard, then rate it |

## Updates

On Windows, and with the Linux AppImage, Avalanche checks for a newer version shortly after it starts. When there is one, a notice appears in
the top bar; you choose when to download it and when to restart to install it.

**Settings → Updates** lets you turn the automatic check off, check by hand, and open **Version
history**, which lists every version with what changed. From there you can also go back to an
earlier version. Going back is at your own risk: an older version may not understand everything a
newer one saved.

On a Mac, and if you installed the Linux `.deb`, update by downloading the new version from the
Releases page.

## Privacy

Your documents never leave your computer. The part of the app that holds them cannot reach the
internet at all. The only connection Avalanche makes is the update check, which asks this page
whether a newer version exists; nothing about you or your files is sent.

Your documents, slides, notes, and LaTeX projects are in your workspace folder. Everything else
(flashcards, tasks, reminders, settings, the Home layout, pictures you added to Home, and automatic
backups of that data) is in the app's own folder:

| System | App folder |
|---|---|
| Windows | `%APPDATA%\Avalanche` |
| macOS | `~/Library/Application Support/Avalanche` |
| Linux | `~/.config/Avalanche` |

To back everything up, copy your workspace folder and the app folder.

## Good to know

Avalanche is at version 0.1, and some things are not there yet:

- Reminders and the focus timer only notify you while the app is open.
- Documents are edited as one continuous page: pages are not broken automatically, and there are no
  headers, footers, or page numbers.
- Opening files made in Word or PowerPoint converts them and loses some formatting.
- Slides have no tables, charts, or animations.
- There is no translation.
- The writing help is for English.
- The Mac and Linux versions are new and have been tested less than the Windows one.

## License

Avalanche is free to download and use. The source code is published so people can read it and suggest
improvements, but it may not be redistributed or republished as a separate app. The terms are in
[LICENSE](LICENSE).
