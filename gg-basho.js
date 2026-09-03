/*  SUMO SLAPDOWN — the honbasho calendar, shared
 *  ---------------------------------------------------------------
 *  One copy of the tournament schedule and the phase maths that reads it.
 *  fantasy.html's draft countdown and the homepage strip both run off this.
 *
 *  It exists because the table used to live inside fantasy.html, and putting
 *  a second copy on the home page would have meant two places to edit when
 *  the JSA announces Kyushu's dates — with nothing to catch it if only one
 *  got done. Dates that disagree between two pages are the kind of bug
 *  nobody reports; they just quietly show the wrong countdown.
 *
 *  Load AFTER gg-config.js (it hangs off the same GyojiGuide global).
 *  NOTHING HERE TOUCHES THE NETWORK. Every phase below is derived from these
 *  dates and the clock, which is what lets the homepage strip paint instantly
 *  and stay silent for the ~275 days a year no tournament is being fought.
 */
(function () {
  var GG = (window.GyojiGuide = window.GyojiGuide || {});

  /* Honbasho run six times a year in a fixed rotation, but the exact dates are
     announced tournament by tournament — so this is a short, hand-maintained
     table rather than a "+6 weeks" guess. Add the next confirmed dates here
     once the JSA announces them.

     banzuke: the JSA publishes the ranking the Monday 13 days before Day 1
     (~6am JST). The fantasy draft stays LOCKED until that moment, because
     ranks aren't known before it. */
  var SCHEDULE = [
    { name:"Aki 2026",    venue:"Tokyo",   banzuke:"2026-08-31T06:00:00+09:00", start:"2026-09-13T00:00:00+09:00", end:"2026-09-27T23:59:59+09:00" },
    { name:"Kyushu 2026", venue:"Fukuoka", banzuke:"2026-10-26T06:00:00+09:00", start:"2026-11-08T00:00:00+09:00", end:"2026-11-22T23:59:59+09:00" }
  ];

  /* How long a finished basho keeps the strip after the last bout: long enough
     that the champion is still showing the following weekend, short enough
     that the page turns itself over to the next tournament unattended. */
  var AFTERGLOW_DAYS = 3;

  function ms(d){ return new Date(d).getTime(); }

  var B = {
    schedule: SCHEDULE,

    /* the next tournament that hasn't started yet */
    next: function (now) {
      now = now || Date.now();
      for (var i = 0; i < SCHEDULE.length; i++) if (ms(SCHEDULE[i].start) > now) return SCHEDULE[i];
      return null;
    },

    /* the one being fought right now, if any */
    current: function (now) {
      now = now || Date.now();
      for (var i = 0; i < SCHEDULE.length; i++)
        if (ms(SCHEDULE[i].start) <= now && now <= ms(SCHEDULE[i].end)) return SCHEDULE[i];
      return null;
    },

    banzukeOut: function (b, now) {
      now = now || Date.now();
      return !b || !b.banzuke || ms(b.banzuke) <= now;
    },

    /* Which of the fifteen days is being fought, from the calendar alone.
       NOTE this runs AHEAD of Meta.lastDay for most of any given day —
       lastDay only advances once that day's bouts have been imported. Use
       this for "Day 6 of 15"; use lastDay for anything describing RESULTS,
       or you'll credit a score to bouts that haven't happened yet. */
    dayOf: function (b, now) {
      if (!b) return 0;
      now = now || Date.now();
      return Math.max(1, Math.min(15, Math.floor((now - ms(b.start)) / 86400000) + 1));
    },

    /* Everything a renderer needs, in one object:
         live     — a tournament is being fought
         final    — one finished within the afterglow window
         upcoming — one is announced and not started
         idle     — the table has run out; add the next dates above */
    state: function (now) {
      now = now || Date.now();
      var i;

      var live = B.current(now);
      if (live) return { phase:"live", basho:live, day:B.dayOf(live, now), banzukeOut:true };

      var justEnded = null;
      for (i = 0; i < SCHEDULE.length; i++) {
        var e = ms(SCHEDULE[i].end);
        if (now > e && now <= e + AFTERGLOW_DAYS * 86400000) justEnded = SCHEDULE[i];
      }
      if (justEnded) return { phase:"final", basho:justEnded, day:15, banzukeOut:true };

      var nxt = B.next(now);
      if (nxt) return { phase:"upcoming", basho:nxt, day:0,
                        msToStart: ms(nxt.start) - now,
                        msToBanzuke: ms(nxt.banzuke) - now,
                        banzukeOut: B.banzukeOut(nxt, now) };

      return { phase:"idle", basho:null, day:0, banzukeOut:true };
    },

    /* "9d 14:22:01" — days only when there are any, so it fits one line */
    countdown: function (msLeft) {
      var s = Math.max(0, Math.floor(msLeft / 1000));
      var d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600),
          m = Math.floor((s % 3600) / 60), sec = s % 60;
      function p(n){ return String(n).length < 2 ? "0" + n : String(n); }
      return (d ? d + "d " : "") + p(h) + ":" + p(m) + ":" + p(sec);
    }
  };

  GG.basho = B;
  /* fantasy.html's original name for the table, so its countdown keeps
     reading the same array rather than a copy of it. */
  GG.UPCOMING_BASHO = SCHEDULE;
})();
