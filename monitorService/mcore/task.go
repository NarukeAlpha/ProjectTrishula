package mcore

import (
	"ProjectTrishula/Core"
	"github.com/playwright-community/playwright-go"
	"io"
	"log"
	"math/rand"
	"sync"
	"time"
)

func TaskInit(mw io.Writer, mL []DbMangaEntry, pL []ProxyStruct, wbKey string) {
	//old implementation was gigascuffed, needs a full rewrite to take advantage of concurrency
	//removed go routines for now, will be redone as application grows bigger but initial structure was made
	//keeping in mind later implementation.
	for {
		for _, proxy := range pL {
			Task(mw, proxy, mL, wbKey)
			if err := recover(); err != nil {
				log.Printf("Recovered from panic: %v", err)
			}
			time.Sleep(3 * time.Minute)

		}
		var wg sync.WaitGroup
		mChannel := make(chan []DbMangaEntry)
		MangaSync(mChannel, &wg)
		mL = <-mChannel
		close(mChannel)
		log.Printf("Manga list Synced")
		time.Sleep(10 * time.Minute)
	}

}

func PlaywrightInit(proxy ProxyStruct) playwright.BrowserContext {
	pw, err := playwright.Run()
	if err != nil {
		log.Panicf("could not start playwright: %v", err)
	}
	width := 1104
	height := 724
	viewprt := playwright.BrowserTypeLaunchPersistentContextOptionsViewport{Width: &width, Height: &height}
	//	var pth = `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`
	//extensionPath := "C:\\Users\\bagaa\\AppData\\Local\\Microsoft\\Edge\\User Data\\Default\\Extensions\\odfafepnkmbhccpbejgmiehpchacaeak\\1.48.0_0"
	var pwProxyStrct = playwright.BrowserTypeLaunchPersistentContextOptionsProxy{
		Server:   &proxy.ip,
		Username: &proxy.usr,
		Password: &proxy.pw,
	}
	browser, err := pw.Chromium.LaunchPersistentContext("", playwright.BrowserTypeLaunchPersistentContextOptions{
		//	Headless:  playwright.Bool(false),
		UserAgent: &UserAgent[rand.Intn(8)],
		Proxy:     &pwProxyStrct,
		Viewport:  &viewprt,
		//		ExecutablePath: &pth,
		ColorScheme: playwright.ColorSchemeDark,
		IgnoreDefaultArgs: []string{
			"--enable-automation",
		},
		//Args: []string{
		//	fmt.Sprintf("--disable-extensions-except=%s", extensionPath),
		//	fmt.Sprintf("--load-extension=%s", extensionPath),
		//},
	})
	if err != nil {
		log.Panicf("could not launch browser: %v", err)
	}
	return browser
}

func Task(mw io.Writer, proxy ProxyStruct, manga []DbMangaEntry, wbKey string) {

	browser := PlaywrightInit(proxy)
	page, err := browser.NewPage()
	if err != nil {
		log.Fatalf("could not create page: %v", err)
	}
	for i := 0; i < len(manga); i++ {
		cLink := ChapterLinkIncrementer(manga[i].DchapterLink, manga[i].DlastChapter)
		if theMap[manga[i].Didentifier](manga[i], browser, page, cLink) {
			WebhookSend(manga[i], wbKey)
			manga[i].DlastChapter = manga[i].DlastChapter + 1
			manga[i].DchapterLink = cLink
			MangaUpdate(manga[i])
			log.Printf("PAGE IS LIVE")
		} else {
			log.Printf("Page not live, will keep monitoring")
			continue
		}
	}
	log.Printf("finished task for proxy :%v", proxy.ip)
	Core.AssertErrorToNil("Failed to close Page", page.Close())
	Core.AssertErrorToNil("Failed to close Browser", browser.Close())

}
