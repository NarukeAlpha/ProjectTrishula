package discordService

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"sync"

	"github.com/bwmarrin/discordgo"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

type MangaEntry struct {
	Did          primitive.ObjectID `json:"_id"`
	Dmanga       string             `json:"manga"`
	DlastChapter int                `json:"lastChapter"`
	Dmonitoring  bool               `json:"monitoring"`
	DchapterLink string             `json:"chapterLink"`
	Didentifier  string             `json:"identifier"`
}

// Bot parameters
var (
	GuildID        string
	BotToken       string
	RemoveCommands bool
	//GuildID        = flag.String("guild", "", "Test guild ID. If not passed - bot registers commands globally")
	//BotToken       = flag.String("token", "", "Bot access token")
	//RemoveCommands = flag.Bool("rmcmd", true, "Remove all commands after shutdowning or not")
)

var s *discordgo.Session

var (
	integerOptionMinValue          = 1.0
	dmPermission                   = false
	defaultMemberPermissions int64 = discordgo.PermissionManageServer

	commands = []*discordgo.ApplicationCommand{
		{
			Name:        "add-manga",
			Description: "PLEASE READ THE OPTION DESCRIPTIONS",
			Options: []*discordgo.ApplicationCommandOption{
				{
					Type:        discordgo.ApplicationCommandOptionString,
					Name:        "name",
					Description: "name of the manga NO spaces",
					Required:    true,
				},
				{
					Type:        discordgo.ApplicationCommandOptionString,
					Name:        "website",
					Description: "example mangasee123.com/manga/example-chapter-1",
					Required:    true,
				},
				{
					Type:        discordgo.ApplicationCommandOptionInteger,
					Name:        "latest-chapter",
					Description: "The latest released chapter",
					Required:    true,
				},
			},
		},
	}

	commandHandlers = map[string]func(s *discordgo.Session, i *discordgo.InteractionCreate){
		"add-manga": func(s *discordgo.Session, i *discordgo.InteractionCreate) {
			// Access options in the order provided by the user.
			options := i.ApplicationCommandData().Options

			// Or convert the slice into a map
			optionMap := make(map[string]*discordgo.ApplicationCommandInteractionDataOption, len(options))
			for _, opt := range options {
				optionMap[opt.Name] = opt
			}

			// This example stores the provided arguments in an []interface{}
			// which will be used to format the bot's response
			margs := make([]interface{}, 0, len(options))
			msgformat := "You have submitted the following to the monitor:\n"

			// Get the value from the option map.
			// When the option exists, ok = true
			if option, ok := optionMap["website"]; ok {
				margs = append(margs, option.StringValue())
				msgformat += "> string-option: %s\n"
			}

			if opt, ok := optionMap["latest-chapter"]; ok {
				margs = append(margs, opt.IntValue())
				msgformat += "> integer-option: %d\n"
			}

			if option, ok := optionMap["name"]; ok {
				margs = append(margs, option.StringValue())
				msgformat += "> string-option: %s\n"
			}
			if option, ok := optionMap["release-method"]; ok {
				margs = append(margs, option.StringValue())
				msgformat += "> string-option: %s\n"
			}

			//channel, err := s.Channel(i.ChannelID)
			//if err != nil {
			//	log.Println(err)
			//}
			//guild, err := s.Guild(i.GuildID)
			intconv := int(margs[1].(int64))
			identifier := identifierRegex(margs[0].(string))
			var entry MangaEntry = MangaEntry{
				Did:          primitive.NewObjectID(),
				Dmanga:       margs[2].(string),
				DlastChapter: intconv,
				Dmonitoring:  true,
				DchapterLink: margs[0].(string),
				Didentifier:  identifier,
			}
			MangaUpdate(entry)

			err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
				// Ignore type for now, they will be discussed in "responses"
				Type: discordgo.InteractionResponseChannelMessageWithSource,
				Data: &discordgo.InteractionResponseData{
					Content: fmt.Sprintf(
						msgformat,
						margs...,
					),
				},
			})
			if err != nil {
				log.Println(err)
				return
			}
		},
	}
)

func identifierRegex(identifier string) string {
	u, err := url.Parse(identifier)
	if err != nil {
		log.Panicf("Invalid URL: %v", err)
	}
	hostParts := strings.Split(u.Hostname(), ".")
	log.Printf("HostParts: %v was added as an identifier", hostParts)

	return hostParts[len(hostParts)-2]
}

func Main(discordConnection struct {
	GuildID  string `json:"guildID"`
	BotToken string `json:"botToken"`
	RemCmd   bool   `json:"remCmd"`
}, group *sync.WaitGroup) {

	GuildID = discordConnection.GuildID
	BotToken = discordConnection.BotToken
	RemoveCommands = discordConnection.RemCmd

	log.Println("Starting bot...")

	var err error
	s, err = discordgo.New("Bot " + BotToken)
	if err != nil {
		log.Fatalf("Invalid bot parameters: %v", err)
	}
	s.AddHandler(func(s *discordgo.Session, i *discordgo.InteractionCreate) {
		if h, ok := commandHandlers[i.ApplicationCommandData().Name]; ok {
			h(s, i)
		}
	})

	s.AddHandler(func(s *discordgo.Session, r *discordgo.Ready) {
		log.Printf("Logged in as: %v#%v", s.State.User.Username, s.State.User.Discriminator)
	})
	err = s.Open()
	if err != nil {
		log.Fatalf("Cannot open the session: %v", err)
	}

	log.Println("Adding commands...")
	registeredCommands := make([]*discordgo.ApplicationCommand, len(commands))
	for i, v := range commands {
		cmd, err := s.ApplicationCommandCreate(s.State.User.ID, GuildID, v)
		if err != nil {
			log.Panicf("Cannot create '%v' command: %v", v.Name, err)
		}
		registeredCommands[i] = cmd
	}
	log.Println("Commands added, App is live")

	defer func(s *discordgo.Session) {
		err := s.Close()
		if err != nil {

		}
	}(s)
	group.Done()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt)
	log.Println("Press Ctrl+C to exit")
	<-stop

	if RemoveCommands {
		log.Println("Removing commands...")
		// // We need to fetch the commands, since deleting requires the command ID.
		// // We are doing this from the returned commands on line 375, because using
		// // this will delete all the commands, which might not be desirable, so we
		// // are deleting only the commands that we added.
		// registeredCommands, err := s.ApplicationCommands(s.State.User.ID, *GuildID)
		// if err != nil {
		// 	log.Fatalf("Could not fetch registered commands: %v", err)
		// }

		for _, v := range registeredCommands {
			err := s.ApplicationCommandDelete(s.State.User.ID, GuildID, v.ID)
			if err != nil {
				log.Panicf("Cannot delete '%v' command: %v", v.Name, err)
			}
		}
	}

	log.Println("Gracefully shutting down.")
}

func MangaUpdate(manga MangaEntry) {
	log.Println("Manga being sent to DB server : %v", manga)
	mangaJson, err := json.Marshal(manga)
	if err != nil {
		log.Println(err)
	}
	r, err := http.NewRequest("POST", "http://localhost:8080/Manga/add-manga", bytes.NewBuffer(mangaJson))
	if err != nil {

		log.Println(err)
	}
	defer func(Body io.ReadCloser) {
		err := Body.Close()
		if err != nil {

		}
	}(r.Body)
	r.Header.Set("Content-Type", "application/json")
	clnt := http.DefaultClient
	resp, err := clnt.Do(r)
	if err != nil {
		log.Println(err)

	}
	defer func(Body io.ReadCloser) {
		err := Body.Close()
		if err != nil {

		}
	}(resp.Body)
	//built in a response reader, to be used later for feature completion.
}
