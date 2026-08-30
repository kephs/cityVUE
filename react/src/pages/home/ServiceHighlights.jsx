const services = [
    { icon: "bi-bell", title: "Track Updates", description: "Stay informed about the status of your request." },
    { icon: "bi-calendar3", title: "Request Services", description: "Request non-emergency city services quickly." },
    { icon: "bi-chat-square-text", title: "Stay Connected", description: "Get the latest news and important updates." }
];

export default function ServiceHighlights() {
    return (
        <section className="home-service-highlights" aria-label="CityVUE services">
            <div className="home-container home-service-grid">
                {services.map((service) => (
                    <article className="home-service-item" key={service.title}>
                        <div className="home-service-icon" aria-hidden="true">
                            <i className={`bi ${service.icon}`}></i>
                        </div>
                        <div>
                            <h2>{service.title}</h2>
                            <p>{service.description}</p>
                        </div>
                    </article>
                ))}
            </div>
        </section>
    );
}
